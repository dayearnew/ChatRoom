import { Router, type RequestHandler } from "express";
import type { WebRuntime } from "../runtime.js";
import type { RuntimeEventBus } from "../../../app/event-bus.js";
import type { AuthService } from "../../../auth/auth-service.js";
import type { PasskeyService } from "../../../auth/passkey-service.js";
import type {
  AuthenticationResponseJSON,
  RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { ChatRoomError } from "../../../core/errors/chatroom-error.js";
import {
  asyncRoute,
  parseCookie,
  requireString,
} from "../../../presentation/http/http-utils.js";
import { createProcessApiRouter } from "./process-api-router.js";
import { createWorkspaceApiRouter } from "./workspace-api-router.js";
import { createGitApiRouter } from "./git-api-router.js";
import type { IngressPolicy } from "../../../auth/ingress-policy.js";
import type { CloudController } from "../../cloud/controller.js";
import { createCloudApiRouter } from "./cloud-api-router.js";
import { createComputerApiRouter } from "./computer-api-router.js";

const SESSION_COOKIE = "chatroom_session";

export function createApiRouter(
  application: WebRuntime,
  eventBus: RuntimeEventBus,
  auth: AuthService,
  passkeys: PasskeyService,
  ingress: IngressPolicy,
  cloud: CloudController,
  runtimeStatus: () => {
    version: string;
    mcpRequests: number;
    uptimeMinutes: number;
  },
): Router {
  const router = Router();
  router.get("/auth/status", (req, res) => {
    const token = parseCookie(req.headers.cookie, SESSION_COOKIE);
    const enabled = ingress.requiresWebAuth(req);
    const passkeyAvailable = Boolean(ingress.webAuthnOrigin(req));
    res.json({
      enabled,
      authenticated: !enabled || Boolean(token && auth.verifyWebSession(token)),
      passkeyAvailable,
      passkeyRegistered: passkeyAvailable && passkeys.list().length > 0,
    });
  });
  router.post(
    "/auth/login",
    asyncRoute(async (req, res) => {
      if (!ingress.requiresWebAuth(req)) {
        res.json({ authenticated: true });
        return;
      }
      const ownerToken = requireString(
        (req.body as Record<string, unknown>)?.ownerToken,
        "ownerToken",
      );
      const remember =
        (req.body as Record<string, unknown>)?.remember !== false;
      const session = auth.createWebSession(ownerToken, remember);
      setSessionCookie(
        res,
        session.token,
        session.maxAgeSeconds,
        ingress.secureWebCookie(req),
      );
      res.json({ authenticated: true, expiresAt: session.expiresAt });
    }),
  );

  router.post(
    "/auth/passkey/options",
    asyncRoute(async (req, res) => {
      res.json(
        await passkeys.authenticationOptions(ingress.webAuthnOrigin(req)),
      );
    }),
  );
  router.post(
    "/auth/passkey/verify",
    asyncRoute(async (req, res) => {
      const body = req.body as Record<string, unknown>;
      await passkeys.verifyAuthentication({
        challengeId: requireString(body.challengeId, "challengeId"),
        response: body.response as AuthenticationResponseJSON,
      });
      const remember = body.remember !== false;
      const session = auth.createPasskeyWebSession(remember);
      setSessionCookie(
        res,
        session.token,
        session.maxAgeSeconds,
        ingress.secureWebCookie(req),
      );
      res.json({ authenticated: true, expiresAt: session.expiresAt });
    }),
  );
  router.post("/auth/logout", (req, res) => {
    const token = parseCookie(req.headers.cookie, SESSION_COOKIE);
    if (token) auth.revokeWebSession(token);
    const secure = ingress.secureWebCookie(req) ? "; Secure" : "";
    res.setHeader(
      "Set-Cookie",
      `${SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure}`,
    );
    res.json({ authenticated: false });
  });

  router.use(apiAuthentication(auth, ingress));
  router.get("/runtime", (_req, res) => res.json(runtimeStatus()));
  router.get("/auth/passkeys", (_req, res) => res.json(passkeys.list()));
  router.post(
    "/auth/passkeys/register/options",
    asyncRoute(async (req, res) => {
      res.json(await passkeys.registrationOptions(ingress.webAuthnOrigin(req)));
    }),
  );
  router.post(
    "/auth/passkeys/register/verify",
    asyncRoute(async (req, res) => {
      const body = req.body as Record<string, unknown>;
      res.status(201).json(
        await passkeys.verifyRegistration({
          challengeId: requireString(body.challengeId, "challengeId"),
          response: body.response as RegistrationResponseJSON,
          ...(typeof body.name === "string" ? { name: body.name } : {}),
        }),
      );
    }),
  );
  router.delete("/auth/passkeys/:credentialId", (req, res) => {
    passkeys.remove(requireString(req.params.credentialId, "credentialId"));
    res.status(204).end();
  });
  router.get("/operations", (req, res) => {
    res.json(
      application.operations.list({
        limit: numberQuery(req.query.limit, 100, 500),
        offset: numberQuery(req.query.offset, 0, 100000),
        ...(typeof req.query.pluginId === "string"
          ? { pluginId: req.query.pluginId }
          : {}),
        ...(typeof req.query.status === "string"
          ? { status: req.query.status }
          : {}),
      }),
    );
  });
  router.delete("/operations", (_req, res) => {
    res.json(application.operations.clearHistory());
  });
  router.get("/operations/:operationId", (req, res) => {
    const operationId = requireString(req.params.operationId, "operationId");
    const event = application.operations.get(operationId);
    if (!event) throw new ChatRoomError("NOT_FOUND", "Operation not found");
    res.json(event);
  });
  router.use(createWorkspaceApiRouter(application));
  router.use(createGitApiRouter(application));
  router.use(createProcessApiRouter(application));
  router.use(
    createComputerApiRouter(
      application.computer,
      application.operations,
      ingress,
    ),
  );
  router.use(createCloudApiRouter(cloud, application.operations));
  router.get("/events", (req, res) => {
    res.status(200);
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();
    res.write(
      `event: ready\ndata: ${JSON.stringify({ time: new Date().toISOString() })}\n\n`,
    );
    const unsubscribe = eventBus.subscribe((event) => {
      res.write(`event: runtime\ndata: ${JSON.stringify(event)}\n\n`);
    });
    const keepalive = setInterval(() => res.write(": keepalive\n\n"), 15000);
    keepalive.unref();
    req.on("close", () => {
      clearInterval(keepalive);
      unsubscribe();
    });
  });
  return router;
}

function setSessionCookie(
  res: { setHeader(name: string, value: string): void },
  token: string,
  maxAgeSeconds: number | null,
  secureCookie: boolean,
): void {
  const secure = secureCookie ? "; Secure" : "";
  const maxAge = maxAgeSeconds === null ? "" : `; Max-Age=${maxAgeSeconds}`;
  res.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/${maxAge}${secure}`,
  );
}

function apiAuthentication(
  auth: AuthService,
  ingress: IngressPolicy,
): RequestHandler {
  return (req, res, next) => {
    if (!ingress.requiresWebAuth(req)) {
      next();
      return;
    }
    const token = parseCookie(req.headers.cookie, SESSION_COOKIE);
    if (token && auth.verifyWebSession(token)) {
      next();
      return;
    }
    res.status(401).json({
      error: { code: "FORBIDDEN", message: "Authentication required" },
    });
  };
}
function numberQuery(value: unknown, fallback: number, max: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0
    ? Math.min(parsed, max)
    : fallback;
}
