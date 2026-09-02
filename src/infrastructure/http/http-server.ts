import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import express, { type RequestHandler } from "express";
import { toNodeHandler } from "@modelcontextprotocol/node";
import type { AuthInfo, McpHttpHandler } from "@modelcontextprotocol/server";
import type { ChatRoomConfig } from "../../config/types.js";
import type { WebRuntime } from "../../plugins/web/runtime.js";
import type { RuntimeEventBus } from "../../app/event-bus.js";
import type { ExternalAccessRegistry } from "../../app/external-access-registry.js";
import type { AuthService } from "../../auth/auth-service.js";
import type { PasskeyService } from "../../auth/passkey-service.js";
import type { CloudController } from "../../plugins/cloud/controller.js";
import { createApiRouter } from "../../plugins/web/http/api-router.js";
import { createOAuthRouter } from "../../presentation/http/oauth-router.js";
import { errorMiddleware } from "../../presentation/http/http-utils.js";
import { IngressPolicy } from "../../auth/ingress-policy.js";
import { CHATROOM_VERSION } from "../../core/runtime/identity.js";
import { runWithMcpAccessScope } from "../../mcp/server/request-context.js";

const WEB_UI_RESERVED_PREFIXES = [
  "/api",
  "/mcp",
  "/oauth",
  "/.well-known",
  "/assets",
] as const;

export class HttpServer {
  private server: Server | null = null;
  private readonly ingress: IngressPolicy;
  private readonly startedAt = Date.now();
  private mcpRequestCount = 0;

  constructor(
    private readonly config: ChatRoomConfig,
    private readonly application: WebRuntime,
    private readonly eventBus: RuntimeEventBus,
    private readonly auth: AuthService,
    private readonly passkeys: PasskeyService,
    private readonly mcp: McpHttpHandler,
    externalAccess: ExternalAccessRegistry,
    private readonly cloud: CloudController,
  ) {
    this.ingress = new IngressPolicy(config, externalAccess);
  }

  async start(): Promise<void> {
    const app = express();
    app.disable("x-powered-by");
    app.set("trust proxy", false);
    app.use(hostValidation(this.ingress));
    app.use(express.json({ limit: "2mb" }));
    app.use(express.urlencoded({ extended: false, limit: "64kb" }));
    app.use(createOAuthRouter(this.auth, this.ingress));
    app.use("/api", webMutationOrigin(this.ingress));
    app.use(
      "/api",
      createApiRouter(
        this.application,
        this.eventBus,
        this.auth,
        this.passkeys,
        this.ingress,
        this.cloud,
        () => ({
          version: CHATROOM_VERSION,
          mcpRequests: this.mcpRequestCount,
          uptimeMinutes: Math.floor((Date.now() - this.startedAt) / 60000),
        }),
      ),
    );

    const nodeMcp = toNodeHandler(this.mcp, {
      onerror: (error) => console.error("[mcp]", error),
    });
    app.all(
      "/mcp",
      (_req, _res, next) => {
        this.mcpRequestCount += 1;
        next();
      },
      mcpAuthentication(this.auth, this.ingress),
      (req, res) => {
        const scope = this.ingress.isExternalMcp(req) ? "remote" : "local";
        runWithMcpAccessScope(scope, () => {
          void nodeMcp(req, res, req.body);
        });
      },
    );

    const webRoot = fileURLToPath(new URL("../../web/", import.meta.url));
    const webIndexPath = path.join(webRoot, "index.html");
    if (existsSync(webIndexPath)) {
      const webIndex = readFileSync(webIndexPath, "utf8");
      app.use(
        "/assets",
        express.static(path.join(webRoot, "assets"), {
          index: false,
          maxAge: "1y",
          immutable: true,
        }),
      );
      app.use((req, res, next) => {
        const isReserved = WEB_UI_RESERVED_PREFIXES.some(
          (prefix) => req.path === prefix || req.path.startsWith(`${prefix}/`),
        );
        if (req.method !== "GET" || isReserved || !req.accepts("html")) {
          next();
          return;
        }
        res.setHeader("Cache-Control", "no-cache");
        res.status(200).type("html").send(webIndex);
      });
    }
    app.use(errorMiddleware);
    this.server = createServer(app);
    await new Promise<void>((resolve, reject) => {
      this.server!.once("error", reject);
      this.server!.listen(
        this.config.server.port,
        this.config.server.host,
        () => {
          this.server!.off("error", reject);
          resolve();
        },
      );
    });
  }

  address(): AddressInfo | null {
    const value = this.server?.address();
    return value && typeof value === "object" ? value : null;
  }

  async close(): Promise<void> {
    const server = this.server;
    if (!server) return;
    const closed = new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await this.mcp.close();
    server.closeAllConnections();
    await closed;
    this.server = null;
  }
}

function webMutationOrigin(ingress: IngressPolicy): RequestHandler {
  return (req, res, next) => {
    if (
      req.method === "GET" ||
      req.method === "HEAD" ||
      req.method === "OPTIONS"
    ) {
      next();
      return;
    }
    const expectedOrigin = ingress.expectedWebOrigin(req);
    if (!expectedOrigin) {
      next();
      return;
    }
    if (req.headers.origin !== expectedOrigin) {
      res.status(403).json({
        error: {
          code: "FORBIDDEN",
          message: "Request origin is not allowed",
        },
      });
      return;
    }
    next();
  };
}

function hostValidation(ingress: IngressPolicy): RequestHandler {
  return (req, res, next) => {
    const hostname = req.hostname;
    if (!hostname || !ingress.allowedHosts().has(hostname)) {
      res.status(403).json({
        error: { code: "FORBIDDEN", message: "Host header is not allowed" },
      });
      return;
    }
    next();
  };
}

function mcpAuthentication(
  auth: AuthService,
  ingress: IngressPolicy,
): RequestHandler {
  return (req, res, next) => {
    if (!ingress.requiresMcpAuth(req)) {
      next();
      return;
    }
    const header = req.headers.authorization;
    const token =
      typeof header === "string" && header.startsWith("Bearer ")
        ? header.slice(7)
        : null;
    const info = token ? auth.verifyMcpToken(token) : null;
    if (!info) {
      const base = ingress.mcpBaseUrl(req);
      res.setHeader(
        "WWW-Authenticate",
        `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource/mcp"`,
      );
      res.status(401).json({ error: "invalid_token" });
      return;
    }
    (req as unknown as { auth?: AuthInfo }).auth = info;
    next();
  };
}
