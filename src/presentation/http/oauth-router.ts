/** OAuth and owner-session HTTP routes backed by AuthService rather than protocol-specific persistence logic. */
import { Router, type ErrorRequestHandler } from "express";
import type {
  AuthService,
  AuthorizationRequest,
} from "../../auth/auth-service.js";
import type { IngressPolicy } from "../../auth/ingress-policy.js";
import {
  asChatRoomError,
  ChatRoomError,
} from "../../core/errors/chatroom-error.js";
import { escapeHtml, requireString } from "./http-utils.js";

export function createOAuthRouter(
  auth: AuthService,
  ingress: IngressPolicy,
): Router {
  const router = Router();
  router.get("/.well-known/oauth-authorization-server", (req, res) =>
    res.json(auth.authorizationServerMetadata(ingress.mcpBaseUrl(req))),
  );
  router.get("/.well-known/oauth-protected-resource", (req, res) =>
    res.json(auth.protectedResourceMetadata(ingress.mcpBaseUrl(req))),
  );
  router.get("/.well-known/oauth-protected-resource/mcp", (req, res) =>
    res.json(auth.protectedResourceMetadata(ingress.mcpBaseUrl(req))),
  );

  router.post("/oauth/register", (req, res) => {
    const body = req.body as Record<string, unknown>;
    const name =
      typeof body.client_name === "string" ? body.client_name : "MCP Client";
    const redirects = Array.isArray(body.redirect_uris)
      ? body.redirect_uris.filter(
          (value): value is string => typeof value === "string",
        )
      : [];
    res.status(201).json(auth.registerClient(name, redirects));
  });

  router.get("/oauth/authorize", (req, res) => {
    const request = authorizationRequest(req.query);
    if (req.query.response_type !== "code")
      throw new ChatRoomError(
        "INVALID_INPUT",
        "Only response_type=code is supported",
      );
    auth.validateAuthorizationRequest(request);
    res.type("html").send(authorizationPage(request));
  });
  router.post("/oauth/authorize", (req, res) => {
    const body = req.body as Record<string, unknown>;
    const request = authorizationRequest(body);
    const code = auth.approveAuthorization(
      request,
      requireString(body.owner_token, "owner_token"),
    );
    const redirect = new URL(request.redirectUri);
    redirect.searchParams.set("code", code);
    if (request.state) redirect.searchParams.set("state", request.state);
    res.redirect(303, redirect.toString());
  });
  router.post("/oauth/token", (req, res) => {
    const body = req.body as Record<string, unknown>;
    let result;
    if (body.grant_type === "authorization_code") {
      result = auth.exchangeCode({
        code: requireString(body.code, "code"),
        clientId: requireString(body.client_id, "client_id"),
        redirectUri: requireString(body.redirect_uri, "redirect_uri"),
        codeVerifier: requireString(body.code_verifier, "code_verifier"),
      });
    } else if (body.grant_type === "refresh_token") {
      result = auth.exchangeRefreshToken({
        refreshToken: requireString(body.refresh_token, "refresh_token"),
        ...(typeof body.client_id === "string"
          ? { clientId: body.client_id }
          : {}),
      });
    } else {
      throw new ChatRoomError("INVALID_INPUT", "Unsupported OAuth grant_type");
    }
    res.setHeader("Cache-Control", "no-store");
    res.json(result);
  });
  router.post("/oauth/revoke", (req, res) => {
    const body = req.body as Record<string, unknown>;
    const token = typeof body.token === "string" ? body.token : "";
    if (token) auth.revoke(token);
    res.status(200).end();
  });
  router.use(oauthErrorMiddleware());
  return router;
}

function oauthErrorMiddleware(): ErrorRequestHandler {
  return (error, req, res, _next) => {
    const normalized = asChatRoomError(error);
    let code = "invalid_request";
    if (req.path === "/oauth/token" && normalized.code === "FORBIDDEN")
      code = "invalid_grant";
    else if (
      req.path === "/oauth/register" &&
      /redirect/i.test(normalized.message)
    )
      code = "invalid_redirect_uri";
    else if (normalized.code === "FORBIDDEN") code = "access_denied";
    res.setHeader("Cache-Control", "no-store");
    res
      .status(400)
      .json({ error: code, error_description: normalized.message });
  };
}

function authorizationRequest(
  value: Record<string, unknown>,
): AuthorizationRequest {
  const state = typeof value.state === "string" ? value.state : undefined;
  const scopes =
    typeof value.scope === "string" && value.scope.trim()
      ? [...new Set(value.scope.trim().split(/\s+/))]
      : ["mcp"];
  return {
    clientId: requireString(value.client_id, "client_id"),
    redirectUri: requireString(value.redirect_uri, "redirect_uri"),
    codeChallenge: requireString(value.code_challenge, "code_challenge"),
    codeChallengeMethod: requireString(
      value.code_challenge_method,
      "code_challenge_method",
    ),
    scopes,
    ...(state ? { state } : {}),
  };
}
function authorizationPage(request: AuthorizationRequest): string {
  const hidden = (name: string, value: string) =>
    `<input type="hidden" name="${name}" value="${escapeHtml(value)}">`;
  const fields = [
    hidden("client_id", request.clientId),
    hidden("redirect_uri", request.redirectUri),
    hidden("code_challenge", request.codeChallenge),
    hidden("code_challenge_method", request.codeChallengeMethod),
    hidden("scope", request.scopes.join(" ")),
    request.state ? hidden("state", request.state) : "",
  ].join("");

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width">
  <title>Authorize ChatRoom</title>
  <style>
    body { font: 15px system-ui; margin: 0; background: #0b0d10; color: #edf1f5; display: grid; place-items: center; min-height: 100vh; }
    .card {
      width: min(440px, calc(100% - 32px));
      background: #14181d;
      border: 1px solid #2a3038;
      border-radius: 14px;
      padding: 24px;
      box-sizing: border-box;
    }
    h1 { font-size: 20px; margin: 0 0 8px; }
    p { color: #aeb8c4; line-height: 1.5; }
    label { display: block; font-size: 12px; color: #aeb8c4; margin: 18px 0 7px; }
    input[type=password] {
      width: 100%;
      box-sizing: border-box;
      background: #0c0f13;
      color: white;
      border: 1px solid #39414b;
      border-radius: 8px;
      padding: 10px;
    }
    button {
      margin-top: 16px;
      width: 100%;
      border: 0;
      border-radius: 8px;
      padding: 10px;
      background: #edf1f5;
      color: #111;
      font-weight: 650;
      cursor: pointer;
    }
  </style>
</head>
<body>
  <form class="card" method="post" action="/oauth/authorize">
    <h1>Authorize MCP client</h1>
    <p>Approve this client to access ChatRoom through the MCP endpoint.</p>
    ${fields}
    <label for="owner_token">Owner token</label>
    <input id="owner_token" name="owner_token" type="password" autocomplete="current-password" required>
    <button type="submit">Authorize</button>
  </form>
</body>
</html>`;
}
