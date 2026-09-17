import { Router, type RequestHandler } from "express";
import type {
  AuthenticationResponseJSON,
  RegistrationResponseJSON,
} from "@simplewebauthn/server";
import type { AuthService } from "../../../auth/auth-service.js";
import type { IngressPolicy } from "../../../auth/ingress-policy.js";
import type { PasskeyService } from "../../../auth/passkey-service.js";
import type { SystemLogSink } from "../../../core/logging/types.js";
import {
  asyncRoute,
  parseCookie,
  requireString,
} from "../../../presentation/http/http-utils.js";

const SESSION_COOKIE = "chatroom_session";

export function createPublicAuthApiRouter(
  auth: AuthService,
  passkeys: PasskeyService,
  ingress: IngressPolicy,
  logger: SystemLogSink,
): Router {
  const router = Router();

  router.get("/auth/status", (req, res) => {
    const token = sessionToken(req.headers.cookie);
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
      const body = req.body as Record<string, unknown>;
      try {
        const session = auth.createWebSession(
          requireString(body.ownerToken, "ownerToken"),
          body.remember !== false,
        );
        setSessionCookie(
          res,
          session.token,
          session.maxAgeSeconds,
          ingress.secureWebCookie(req),
        );
        logger.info("auth", "auth.success", "Web authentication succeeded", {
          method: "owner_token",
        });
        res.json({ authenticated: true, expiresAt: session.expiresAt });
      } catch (error) {
        logger.warn("auth", "auth.failed", "Web authentication failed", {
          method: "owner_token",
          reason: "invalid_owner_token",
        });
        throw error;
      }
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
      try {
        await passkeys.verifyAuthentication({
          challengeId: requireString(body.challengeId, "challengeId"),
          response: body.response as AuthenticationResponseJSON,
        });
        const session = auth.createPasskeyWebSession(body.remember !== false);
        setSessionCookie(
          res,
          session.token,
          session.maxAgeSeconds,
          ingress.secureWebCookie(req),
        );
        logger.info(
          "auth",
          "auth.passkey_success",
          "Passkey authentication succeeded",
        );
        res.json({ authenticated: true, expiresAt: session.expiresAt });
      } catch (error) {
        logger.warn(
          "auth",
          "auth.passkey_failed",
          "Passkey authentication failed",
          { reason: "passkey_verification_failed" },
        );
        throw error;
      }
    }),
  );

  router.post("/auth/logout", (req, res) => {
    const token = sessionToken(req.headers.cookie);
    if (token) {
      auth.revokeWebSession(token);
      logger.info("auth", "auth.logout", "Web session signed out");
    }
    const secure = ingress.secureWebCookie(req) ? "; Secure" : "";
    res.setHeader(
      "Set-Cookie",
      `${SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure}`,
    );
    res.json({ authenticated: false });
  });

  return router;
}

export function createPrivateAuthApiRouter(
  passkeys: PasskeyService,
  ingress: IngressPolicy,
  logger: SystemLogSink,
): Router {
  const router = Router();

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
      try {
        const passkey = await passkeys.verifyRegistration({
          challengeId: requireString(body.challengeId, "challengeId"),
          response: body.response as RegistrationResponseJSON,
          ...(typeof body.name === "string" ? { name: body.name } : {}),
        });
        logger.info("auth", "auth.passkey_registered", "Passkey registered");
        res.status(201).json(passkey);
      } catch (error) {
        logger.warn(
          "auth",
          "auth.passkey_register_failed",
          "Passkey registration failed",
          { reason: "passkey_registration_failed" },
        );
        throw error;
      }
    }),
  );
  router.delete("/auth/passkeys/:credentialId", (req, res) => {
    passkeys.remove(requireString(req.params.credentialId, "credentialId"));
    logger.info("auth", "auth.passkey_removed", "Passkey removed");
    res.status(204).end();
  });

  return router;
}

export function apiAuthentication(
  auth: AuthService,
  ingress: IngressPolicy,
): RequestHandler {
  return (req, res, next) => {
    if (!ingress.requiresWebAuth(req)) {
      next();
      return;
    }
    const token = sessionToken(req.headers.cookie);
    if (token && auth.verifyWebSession(token)) {
      next();
      return;
    }
    res.status(401).json({
      error: { code: "FORBIDDEN", message: "Authentication required" },
    });
  };
}

function sessionToken(cookieHeader: string | undefined): string | null {
  return parseCookie(cookieHeader, SESSION_COOKIE);
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
