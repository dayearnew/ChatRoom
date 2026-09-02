import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import type { AuthInfo } from "@modelcontextprotocol/server";
import { ChatRoomError } from "../core/errors/chatroom-error.js";
import type { OAuthStateRepository } from "../core/auth/repository.js";
import type { WebSessionRepository } from "../core/auth/session-repository.js";
import type { ChatRoomConfig } from "../config/types.js";

export interface AuthorizationRequest {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  scopes: string[];
  state?: string;
}

export class AuthService {
  constructor(
    private readonly repository: OAuthStateRepository,
    private readonly sessions: WebSessionRepository,
    private readonly config: ChatRoomConfig["auth"],
  ) {
    const now = new Date().toISOString();
    repository.prune(now);
    sessions.prune(now);
  }

  private verifyOwnerToken(value: string): boolean {
    if (!this.config.ownerToken) return false;
    // Hash to fixed-length inputs before timingSafeEqual so differing token lengths do not short-circuit comparison.
    return safeEqual(digest(value), digest(this.config.ownerToken));
  }

  registerClient(name: string, redirectUris: string[]) {
    if (!name || redirectUris.length === 0)
      throw new ChatRoomError(
        "INVALID_INPUT",
        "client_name and redirect_uris are required",
      );
    for (const redirect of redirectUris) this.validateRedirect(redirect);
    const clientId = `client_${randomUUID()}`;
    this.repository.createClient({
      clientId,
      name,
      redirectUris,
      createdAt: new Date().toISOString(),
    });
    return {
      client_id: clientId,
      client_name: name,
      redirect_uris: redirectUris,
      token_endpoint_auth_method: "none" as const,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    };
  }

  validateAuthorizationRequest(request: AuthorizationRequest): void {
    const client = this.repository.getClient(request.clientId);
    if (!client)
      throw new ChatRoomError("INVALID_INPUT", "Unknown OAuth client_id");
    if (!client.redirectUris.includes(request.redirectUri))
      throw new ChatRoomError(
        "FORBIDDEN",
        "redirect_uri is not registered for this client",
      );
    this.validateRedirect(request.redirectUri);
    // Only S256 is supported; plain PKCE would expose the verifier-equivalent value in the authorization request.
    if (
      request.codeChallengeMethod !== "S256" ||
      !/^[A-Za-z0-9_-]{43,128}$/.test(request.codeChallenge)
    ) {
      throw new ChatRoomError("INVALID_INPUT", "PKCE S256 is required");
    }
    const supported = new Set(["mcp"]);
    if (
      !request.scopes.includes("mcp") ||
      request.scopes.some((scope) => !supported.has(scope))
    ) {
      throw new ChatRoomError("INVALID_INPUT", "Unsupported OAuth scope");
    }
  }

  approveAuthorization(
    request: AuthorizationRequest,
    providedOwnerToken: string,
  ): string {
    this.repository.prune(new Date().toISOString());
    this.validateAuthorizationRequest(request);
    if (!this.verifyOwnerToken(providedOwnerToken))
      throw new ChatRoomError("FORBIDDEN", "Owner token is invalid");
    const code = randomBytes(32).toString("base64url");
    this.repository.createCode({
      codeHash: digest(code),
      clientId: request.clientId,
      redirectUri: request.redirectUri,
      codeChallenge: request.codeChallenge,
      scope: request.scopes.join(" "),
      expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      usedAt: null,
    });
    return code;
  }

  exchangeCode(input: {
    code: string;
    clientId: string;
    redirectUri: string;
    codeVerifier: string;
  }) {
    if (!/^[A-Za-z0-9._~-]{43,128}$/.test(input.codeVerifier))
      throw new ChatRoomError("INVALID_INPUT", "Invalid PKCE code_verifier");
    const codeHash = digest(input.code);
    const candidate = this.repository.getCode(codeHash);
    if (
      !candidate ||
      candidate.clientId !== input.clientId ||
      candidate.redirectUri !== input.redirectUri ||
      Date.parse(candidate.expiresAt) <= Date.now()
    ) {
      throw new ChatRoomError(
        "FORBIDDEN",
        "Authorization code is invalid or expired",
      );
    }
    const challenge = createHash("sha256")
      .update(input.codeVerifier)
      .digest("base64url");
    if (!safeEqual(challenge, candidate.codeChallenge))
      throw new ChatRoomError("FORBIDDEN", "PKCE verification failed");
    // Consume only after all client, redirect, expiry, and PKCE checks pass so a bad verifier cannot burn the code.
    const code = this.repository.consumeCode(
      codeHash,
      new Date().toISOString(),
    );
    if (!code)
      throw new ChatRoomError(
        "FORBIDDEN",
        "Authorization code has already been used",
      );
    return this.issueOAuthTokens(input.clientId, candidate.scope);
  }

  exchangeRefreshToken(input: { refreshToken: string; clientId?: string }) {
    this.repository.prune(new Date().toISOString());
    const consumed = this.repository.consumeRefreshToken(
      digest(input.refreshToken),
      input.clientId,
    );
    if (!consumed)
      throw new ChatRoomError(
        "FORBIDDEN",
        "Refresh token is invalid or expired",
      );
    return this.issueOAuthTokens(consumed.clientId, consumed.scope);
  }

  createWebSession(
    providedOwnerToken: string,
    remember = true,
  ): { token: string; expiresAt: string; maxAgeSeconds: number | null } {
    if (!this.verifyOwnerToken(providedOwnerToken))
      throw new ChatRoomError("FORBIDDEN", "Owner token is invalid");
    return this.issueWebSession(remember);
  }

  createPasskeyWebSession(remember = true): {
    token: string;
    expiresAt: string;
    maxAgeSeconds: number | null;
  } {
    return this.issueWebSession(remember);
  }

  private issueWebSession(remember: boolean) {
    this.sessions.prune(new Date().toISOString());
    const lifetimeSeconds = remember ? 30 * 24 * 60 * 60 : 8 * 60 * 60;
    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(
      Date.now() + lifetimeSeconds * 1000,
    ).toISOString();
    this.sessions.create(digest(token), expiresAt);
    return {
      token,
      expiresAt,
      maxAgeSeconds: remember ? lifetimeSeconds : null,
    };
  }

  verifyWebSession(token: string): boolean {
    return this.sessions.valid(digest(token), new Date().toISOString());
  }

  revokeWebSession(token: string): void {
    this.sessions.revoke(digest(token));
  }

  private verifyToken(token: string, requiredScope?: string) {
    const info = this.repository.tokenInfo(digest(token));
    if (!info) return null;
    if (requiredScope && !info.scope.split(/\s+/).includes(requiredScope))
      return null;
    return info;
  }

  verifyMcpToken(token: string): AuthInfo | null {
    const info = this.verifyToken(token, "mcp");
    if (!info) return null;
    return {
      token,
      clientId: info.clientId,
      scopes: info.scope.split(/\s+/),
      expiresAt: Math.floor(Date.parse(info.expiresAt) / 1000),
    };
  }

  revoke(token: string): void {
    this.repository.revokeToken(digest(token));
  }

  authorizationServerMetadata(baseUrl: string) {
    return {
      issuer: baseUrl,
      authorization_endpoint: `${baseUrl}/oauth/authorize`,
      token_endpoint: `${baseUrl}/oauth/token`,
      registration_endpoint: `${baseUrl}/oauth/register`,
      revocation_endpoint: `${baseUrl}/oauth/revoke`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      scopes_supported: ["mcp"],
    };
  }

  protectedResourceMetadata(baseUrl: string) {
    return {
      resource: `${baseUrl}/mcp`,
      authorization_servers: [baseUrl],
      scopes_supported: ["mcp"],
      bearer_methods_supported: ["header"],
    };
  }

  private issueAccessToken(clientId: string, scope: string, seconds: number) {
    const token = randomBytes(32).toString("base64url");
    this.repository.createToken(
      digest(token),
      clientId,
      scope,
      new Date(Date.now() + seconds * 1000).toISOString(),
    );
    return {
      access_token: token,
      token_type: "Bearer" as const,
      expires_in: seconds,
      scope,
    };
  }

  private issueOAuthTokens(clientId: string, scope: string) {
    this.repository.prune(new Date().toISOString());
    const access = this.issueAccessToken(clientId, scope, 60 * 60);
    const refreshToken = randomBytes(48).toString("base64url");
    this.repository.createRefreshToken(
      digest(refreshToken),
      clientId,
      scope,
      new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
    );
    return { ...access, refresh_token: refreshToken };
  }

  private validateRedirect(value: string): void {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new ChatRoomError("INVALID_INPUT", "Invalid redirect_uri");
    }
    // OAuth permits HTTP only for loopback development redirects; all remote redirects must use HTTPS.
    const loopback =
      url.hostname === "localhost" ||
      url.hostname === "127.0.0.1" ||
      url.hostname === "::1";
    if (url.protocol !== "https:" && !loopback)
      throw new ChatRoomError(
        "FORBIDDEN",
        "OAuth redirects must use HTTPS unless loopback",
      );
    if (!this.config.allowedRedirectHosts.includes(url.hostname))
      throw new ChatRoomError(
        "FORBIDDEN",
        `OAuth redirect host is not allowed: ${url.hostname}`,
      );
  }
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
