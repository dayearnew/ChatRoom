export interface OAuthClientRecord {
  clientId: string;
  name: string;
  redirectUris: string[];
  createdAt: string;
}

export interface OAuthCodeRecord {
  codeHash: string;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  scope: string;
  expiresAt: string;
  usedAt: string | null;
}

export interface OAuthTokenRecord {
  clientId: string;
  scope: string;
  expiresAt: string;
}

export interface OAuthStateRepository {
  createClient(client: OAuthClientRecord): void;
  getClient(clientId: string): OAuthClientRecord | null;
  createCode(code: OAuthCodeRecord): void;
  getCode(codeHash: string): OAuthCodeRecord | null;
  consumeCode(codeHash: string, now: string): OAuthCodeRecord | null;
  createToken(
    tokenHash: string,
    clientId: string,
    scope: string,
    expiresAt: string,
  ): void;
  createRefreshToken(
    tokenHash: string,
    clientId: string,
    scope: string,
    expiresAt: string,
  ): void;
  consumeRefreshToken(
    tokenHash: string,
    clientId?: string,
  ): { clientId: string; scope: string } | null;
  tokenInfo(tokenHash: string): OAuthTokenRecord | null;
  revokeToken(tokenHash: string): void;
  prune(now: string): number;
}
