import assert from "node:assert/strict";
import test from "node:test";
import type { Request } from "express";
import { defaultConfig } from "../../src/config/load-config.js";
import { ExternalAccessRegistry } from "../../src/app/external-access-registry.js";
import { IngressPolicy } from "../../src/auth/ingress-policy.js";

function request(hostname: string): Request {
  return {
    hostname,
    protocol: "http",
    secure: false,
    get(name: string) {
      return name.toLowerCase() === "host" ? hostname : undefined;
    },
  } as unknown as Request;
}

test("registered and self-hosted public URLs are resolved independently by host", () => {
  const config = defaultConfig();
  config.auth.mcpPublicBaseUrl = "https://self-mcp.example.com";
  config.auth.webPublicBaseUrl = "https://self-web.example.com";
  const registry = new ExternalAccessRegistry(config.auth);
  registry.setCloud({
    mcpBaseUrl: "https://cloud-mcp.example.com",
    webBaseUrl: "https://cloud-web.example.com",
  });
  const policy = new IngressPolicy(config, registry);

  assert.equal(
    policy.mcpBaseUrl(request("cloud-mcp.example.com")),
    "https://cloud-mcp.example.com",
  );
  assert.equal(
    policy.mcpBaseUrl(request("self-mcp.example.com")),
    "https://self-mcp.example.com",
  );
  assert.equal(
    policy.expectedWebOrigin(request("cloud-web.example.com")),
    "https://cloud-web.example.com",
  );
  assert.equal(
    policy.expectedWebOrigin(request("self-web.example.com")),
    "https://self-web.example.com",
  );
});

test("local loopback WebUI stays unauthenticated while registered remote WebUI requires auth", () => {
  const config = defaultConfig();
  const registry = new ExternalAccessRegistry(config.auth);
  registry.setCloud({
    mcpBaseUrl: "https://cloud-mcp.example.com",
    webBaseUrl: "https://cloud-web.example.com",
  });
  const policy = new IngressPolicy(config, registry);

  assert.equal(policy.requiresWebAuth(request("127.0.0.1")), false);
  assert.equal(policy.requiresWebAuth(request("cloud-web.example.com")), true);
  assert.equal(policy.requiresMcpAuth(request("cloud-mcp.example.com")), true);
  assert.deepEqual(policy.webAuthnOrigin(request("cloud-web.example.com")), {
    origin: "https://cloud-web.example.com",
    rpId: "cloud-web.example.com",
  });
});
