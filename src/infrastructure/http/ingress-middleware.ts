import type { AuthInfo } from "@modelcontextprotocol/server";
import type { RequestHandler } from "express";
import type { AuthService } from "#auth/auth-service";
import type { IngressPolicy } from "#auth/ingress-policy";

export function webMutationOrigin(ingress: IngressPolicy): RequestHandler {
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

export function hostValidation(ingress: IngressPolicy): RequestHandler {
  return (req, res, next) => {
    const hostname = req.hostname;
    if (!hostname || !ingress.allowsHost(hostname)) {
      res.status(403).json({
        error: { code: "FORBIDDEN", message: "Host header is not allowed" },
      });
      return;
    }

    next();
  };
}

export function mcpAuthentication(
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
