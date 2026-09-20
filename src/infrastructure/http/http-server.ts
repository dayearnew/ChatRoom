import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import express from "express";
import compression from "compression";
import { toNodeHandler } from "@modelcontextprotocol/node";
import type { McpHttpHandler } from "@modelcontextprotocol/server";
import type { ChatRoomConfig } from "#config/types";
import type { WebRuntime } from "#plugins/web/runtime";
import type { RuntimeEventBus } from "#app/event-bus";
import type { ExternalAccessRegistry } from "#app/external-access-registry";
import type { AuthService } from "#auth/auth-service";
import type { PasskeyService } from "#auth/passkey-service";
import type { CloudController } from "#plugins/cloud/controller";
import { createApiRouter } from "#plugins/web/http/api-router";
import { createOAuthRouter } from "#presentation/http/oauth-router";
import { errorMiddleware } from "#presentation/http/http-utils";
import { IngressPolicy } from "#auth/ingress-policy";
import { CHATROOM_VERSION } from "#core/runtime/identity";
import { runWithMcpAccessScope } from "#mcp/server/request-context";
import type { LogService } from "#core/logging/types";
import {
  hostValidation,
  mcpAuthentication,
  webMutationOrigin,
} from "./ingress-middleware.js";

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
    private readonly logs: LogService,
  ) {
    this.ingress = new IngressPolicy(config, externalAccess);
  }

  async start(): Promise<void> {
    const app = express();
    app.disable("x-powered-by");
    app.set("trust proxy", false);
    app.use(hostValidation(this.ingress));
    app.use(compression({ threshold: 1024 }));
    app.use(express.json({ limit: "2mb" }));
    app.use(express.urlencoded({ extended: false, limit: "64kb" }));
    app.use(createOAuthRouter(this.auth, this.ingress, this.logs));
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
        this.logs,
        () => ({
          version: CHATROOM_VERSION,
          mcpRequests: this.mcpRequestCount,
          uptimeMinutes: Math.floor((Date.now() - this.startedAt) / 60000),
        }),
      ),
    );

    const nodeMcp = toNodeHandler(this.mcp, {
      onerror: (error) =>
        this.logs.error("mcp", "mcp.error", "MCP request failed", { error }),
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
    try {
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
      this.logs.info("http", "http.started", "HTTP server started", {
        host: this.config.server.host,
        port: this.config.server.port,
      });
    } catch (error) {
      this.logs.error(
        "http",
        "http.start_failed",
        "HTTP server failed to start",
        {
          error,
        },
      );
      throw error;
    }
  }

  address(): AddressInfo | null {
    const value = this.server?.address();
    return value && typeof value === "object" ? value : null;
  }

  async close(): Promise<void> {
    const server = this.server;
    if (!server) return;
    this.server = null;

    const errors: unknown[] = [];
    const closed = server.listening
      ? new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        )
      : Promise.resolve();

    try {
      await this.mcp.close();
    } catch (error) {
      errors.push(error);
    }

    server.closeAllConnections();
    try {
      await closed;
    } catch (error) {
      errors.push(error);
    }

    if (errors.length === 1) throw errors[0];
    if (errors.length > 1)
      throw new AggregateError(
        errors,
        "HTTP server shutdown encountered errors",
      );
    this.logs.info("http", "http.stopped", "HTTP server stopped");
  }
}
