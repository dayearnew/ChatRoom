/**
 * Persistence contracts for OAuth clients, authorization codes, and access tokens.
 *
 * Raw authorization codes and bearer tokens must never cross this boundary. AuthService hashes
 * those credentials first and repositories store only the resulting digest values.
 */

/** Dynamically registered OAuth public client. */
export interface OAuthClientRecord {
  clientId: string;
  name: string;
  /** Exact redirect URI allowlist registered for the client. */
  redirectUris: string[];
  createdAt: string;
}

/** Hashed Authorization Code + PKCE state. */
export interface OAuthCodeRecord {
  /** SHA-256 digest of the raw one-time authorization code. */
  codeHash: string;
  clientId: string;
  redirectUri: string;
  /** S256 challenge supplied during authorization. */
  codeChallenge: string;
  /** Granted scopes bound to this authorization code. */
  scope: string;
  expiresAt: string;
  /** Consumption timestamp, or null before the code is atomically used. */
  usedAt: string | null;
}

/** Minimal active-token metadata returned after a hashed token lookup. */
export interface OAuthTokenRecord {
  clientId: string;
  scope: string;
  expiresAt: string;
}

/** Storage port used by AuthService for the complete OAuth state machine. */
export interface OAuthStateRepository {
  createClient(client: OAuthClientRecord): void;
  getClient(clientId: string): OAuthClientRecord | null;
  createCode(code: OAuthCodeRecord): void;
  /** Read an unconsumed candidate without mutating it so PKCE can be validated first. */
  getCode(codeHash: string): OAuthCodeRecord | null;
  /** Atomically consume a valid code; null means it was missing, expired by policy, or already used. */
  consumeCode(codeHash: string, now: string): OAuthCodeRecord | null;
  /** Persist only a token hash together with scope and expiry metadata. */
  createToken(
    tokenHash: string,
    clientId: string,
    scope: string,
    expiresAt: string,
  ): void;
  /** Persist a hashed refresh token separately from access tokens. */
  createRefreshToken(
    tokenHash: string,
    clientId: string,
    scope: string,
    expiresAt: string,
  ): void;
  /** Atomically rotate an active refresh token. */
  consumeRefreshToken(
    tokenHash: string,
    clientId?: string,
  ): { clientId: string; scope: string } | null;
  /** Resolve active, non-revoked token metadata from a token hash. */
  tokenInfo(tokenHash: string): OAuthTokenRecord | null;
  /** Mark a token hash revoked without requiring the raw bearer token to be stored. */
  revokeToken(tokenHash: string): void;
  /** Remove expired and terminal OAuth state that no longer participates in the protocol. */
  prune(now: string): number;
}
