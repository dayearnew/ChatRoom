import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { AppDatabase } from "../../src/infrastructure/database/app-database.js";
import { OAuthRepository } from "../../src/infrastructure/database/oauth-repository.js";
import { WebSessionRepository } from "../../src/infrastructure/database/web-session-repository.js";
import { AuthService } from "../../src/auth/auth-service.js";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

test("OAuth authorization code uses PKCE, hashing, expiry model and one-time consumption", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "chatroom-oauth-"));
  const db = new AppDatabase(path.join(dir, "auth.sqlite"));
  try {
    const repository = new OAuthRepository(db);
    const auth = new AuthService(repository, new WebSessionRepository(db), {
      localWebAuth: false,
      ownerToken: "owner-secret",
      mcpPublicBaseUrl: null,
      webPublicBaseUrl: null,
      allowedRedirectHosts: ["127.0.0.1"],
    });
    const client = auth.registerClient("Test MCP", [
      "http://127.0.0.1/callback",
    ]);
    const verifier = "A".repeat(64);
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const request = {
      clientId: client.client_id,
      redirectUri: "http://127.0.0.1/callback",
      codeChallenge: challenge,
      codeChallengeMethod: "S256",
      scopes: ["mcp"],
    };
    const code = auth.approveAuthorization(request, "owner-secret");
    assert.equal(
      JSON.stringify(repository.getClient(client.client_id)).includes(
        "owner-secret",
      ),
      false,
    );
    const wrongVerifier = `${verifier.slice(0, -1)}B`;
    assert.throws(() =>
      auth.exchangeCode({
        code,
        clientId: client.client_id,
        redirectUri: request.redirectUri,
        codeVerifier: wrongVerifier,
      }),
    );
    const token = auth.exchangeCode({
      code,
      clientId: client.client_id,
      redirectUri: request.redirectUri,
      codeVerifier: verifier,
    });
    const refreshToken = "refresh_token" in token ? token.refresh_token : null;
    assert.equal(typeof refreshToken, "string");
    assert.equal(
      auth.verifyMcpToken(token.access_token)?.clientId,
      client.client_id,
    );
    const refreshed = auth.exchangeRefreshToken({
      refreshToken: refreshToken!,
      clientId: client.client_id,
    });
    assert.equal(
      auth.verifyMcpToken(refreshed.access_token)?.clientId,
      client.client_id,
    );
    assert.equal(
      "refresh_token" in refreshed && typeof refreshed.refresh_token,
      "string",
    );
    assert.throws(() =>
      auth.exchangeRefreshToken({
        refreshToken: refreshToken!,
        clientId: client.client_id,
      }),
    );
    const metadata = auth.authorizationServerMetadata(
      "https://chatroom.example.com",
    );
    assert.deepEqual(metadata.grant_types_supported, [
      "authorization_code",
      "refresh_token",
    ]);
    assert.deepEqual(metadata.scopes_supported, ["mcp"]);
    assert.throws(() =>
      auth.exchangeCode({
        code,
        clientId: client.client_id,
        redirectUri: request.redirectUri,
        codeVerifier: verifier,
      }),
    );
  } finally {
    db.close();
    await rm(dir, { recursive: true, force: true });
  }
});
