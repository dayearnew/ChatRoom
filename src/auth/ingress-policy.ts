import type { Request } from "express";
import type { ChatRoomConfig } from "../config/types.js";
import type {
  ExternalAccessRegistry,
  ExternalAccessKind,
} from "../app/external-access-registry.js";

export interface WebAuthnOrigin {
  origin: string;
  rpId: string;
}

/** Classifies ingress exclusively from configured/registered public hosts. */
export class IngressPolicy {
  constructor(
    private readonly config: ChatRoomConfig,
    private readonly externalAccess: ExternalAccessRegistry,
  ) {}

  allowedHosts(): ReadonlySet<string> {
    const allowed = new Set(["localhost", "127.0.0.1", "::1"]);
    if (
      this.config.server.host !== "0.0.0.0" &&
      this.config.server.host !== "::"
    )
      allowed.add(this.config.server.host);
    for (const host of this.externalAccess.hosts()) allowed.add(host);
    return allowed;
  }

  requiresWebAuth(req: Request): boolean {
    if (this.isExternalWeb(req)) return true;
    return this.config.auth.localWebAuth;
  }

  isExternalWeb(req: Request): boolean {
    return this.externalAccess.matches("web", req.hostname);
  }

  requiresMcpAuth(req: Request): boolean {
    return this.isExternalMcp(req);
  }

  isExternalMcp(req: Request): boolean {
    return this.externalAccess.matches("mcp", req.hostname);
  }

  secureWebCookie(req: Request): boolean {
    const base = this.externalBaseUrl(req, "web");
    if (!base) return req.secure;
    return new URL(base).protocol === "https:";
  }

  expectedWebOrigin(req: Request): string | null {
    const base = this.externalBaseUrl(req, "web");
    return base ? new URL(base).origin : null;
  }

  webAuthnOrigin(req: Request): WebAuthnOrigin | null {
    const base = this.externalBaseUrl(req, "web");
    if (!base) return null;
    const url = new URL(base);
    const loopback =
      url.hostname === "localhost" ||
      url.hostname === "127.0.0.1" ||
      url.hostname === "::1";
    if (url.protocol !== "https:" && !loopback) return null;
    return { origin: url.origin, rpId: url.hostname };
  }

  mcpBaseUrl(req: Request): string {
    const external = this.externalBaseUrl(req, "mcp");
    if (external) return external;
    return `${req.protocol}://${req.get("host") ?? `${this.config.server.host}:${this.config.server.port}`}`.replace(
      /\/$/,
      "",
    );
  }

  private externalBaseUrl(
    req: Request,
    kind: ExternalAccessKind,
  ): string | null {
    return this.externalAccess.baseUrlForHost(kind, req.hostname);
  }
}
