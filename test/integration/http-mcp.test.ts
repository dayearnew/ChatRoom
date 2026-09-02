import assert from "node:assert/strict";
import http from "node:http";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { createTestRuntime } from "../helpers/runtime.js";

test("HTTP API and real MCP client share the same Application runtime", async () => {
  const runtime = await createTestRuntime();
  let client: Client | null = null;
  try {
    await runtime.components.http.start();
    const address = runtime.components.http.address();
    assert.ok(address);
    const base = `http://127.0.0.1:${address.port}`;

    const packageVersion = (
      JSON.parse(readFileSync("package.json", "utf8")) as { version: string }
    ).version;

    client = new Client({
      name: "chatroom-integration-test",
      version: "1.0.0",
    });
    const transport = new StreamableHTTPClientTransport(new URL(`${base}/mcp`));
    await client.connect(transport);
    assert.equal(client.getServerVersion()?.version, packageVersion);
    const tools = await client.listTools();
    assert.ok(tools.tools.some((tool) => tool.name === "workspace_info"));
    assert.ok(tools.tools.some((tool) => tool.name === "computer_snapshot"));
    assert.ok(tools.tools.some((tool) => tool.name === "computer_action"));
    const workspace = await client.callTool({
      name: "workspace_info",
      arguments: { root: runtime.workspaceRoot },
    });
    assert.equal(workspace.isError, undefined);
    assert.equal(
      (workspace.structuredContent as { root: string }).root,
      runtime.workspaceRoot,
    );
    const startedProcess = await client.callTool({
      name: "process_start",
      arguments: {
        command: process.execPath,
        args: ["-e", "setTimeout(() => {}, 5000)"],
        cwd: runtime.workspaceRoot,
        timeoutMs: 5000,
      },
    });
    assert.equal(startedProcess.isError, undefined);
    const processSnapshot = startedProcess.structuredContent as {
      processId: string;
      operationId: string;
    };
    const processOperation = runtime.components.operations.get(
      processSnapshot.operationId,
    );
    assert.equal(processOperation?.pluginId, "process");
    assert.equal(processOperation?.source, "mcp");
    assert.equal(processOperation?.action, "start");
    assert.equal(processOperation?.processId, processSnapshot.processId);
    assert.equal(processOperation?.status, "running");
    await client.callTool({
      name: "process_kill",
      arguments: { processId: processSnapshot.processId, force: true },
    });
  } finally {
    await client?.close().catch(() => undefined);
    await runtime.cleanup();
  }
});

async function requestWithHost(
  port: number,
  requestPath: string,
  options: {
    method: string;
    host: string;
    headers?: Record<string, string>;
    body?: string;
  },
): Promise<{
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}> {
  return await new Promise((resolve, reject) => {
    const request = http.request(
      {
        host: "127.0.0.1",
        port,
        path: requestPath,
        method: options.method,
        headers: { host: options.host, ...(options.headers ?? {}) },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
        response.on("end", () =>
          resolve({
            status: response.statusCode ?? 0,
            headers: response.headers,
            body: Buffer.concat(chunks).toString("utf8"),
          }),
        );
      },
    );
    request.on("error", reject);
    if (options.body) request.end(options.body);
    else request.end();
  });
}

test("remote WebUI mutations require same-origin while loopback WebUI stays local", async () => {
  const runtime = await createTestRuntime({
    configure(config) {
      config.auth.webPublicBaseUrl = "https://chatroom.example.com";
    },
  });
  try {
    await runtime.components.http.start();
    const address = runtime.components.http.address();
    assert.ok(address);
    const base = `http://127.0.0.1:${address.port}`;

    const local = await fetch(`${base}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ownerToken: "not-required-locally" }),
    });
    assert.equal(local.status, 200);

    const rejected = await requestWithHost(address.port, "/api/auth/login", {
      method: "POST",
      host: "chatroom.example.com",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ownerToken: "test-owner-token" }),
    });
    assert.equal(rejected.status, 403);

    const accepted = await requestWithHost(address.port, "/api/auth/login", {
      method: "POST",
      host: "chatroom.example.com",
      headers: {
        "content-type": "application/json",
        origin: "https://chatroom.example.com",
      },
      body: JSON.stringify({ ownerToken: "test-owner-token" }),
    });
    assert.equal(accepted.status, 200);
    const cookie = accepted.headers["set-cookie"]?.[0];
    assert.ok(cookie);
    assert.match(cookie, /Secure/);

    runtime.components.computer.setSettings({
      enabled: true,
      remoteAccess: false,
    });
    const blockedComputerPreview = await requestWithHost(
      address.port,
      "/api/computer/preview",
      {
        method: "GET",
        host: "chatroom.example.com",
        headers: { cookie },
      },
    );
    assert.equal(
      blockedComputerPreview.status,
      403,
      "remote WebUI must not read Computer screenshots while remote access is disabled",
    );

    runtime.components.computer.setSettings({ remoteAccess: true });
    const allowedComputerPreview = await requestWithHost(
      address.port,
      "/api/computer/preview",
      {
        method: "GET",
        host: "chatroom.example.com",
        headers: { cookie },
      },
    );
    assert.equal(allowedComputerPreview.status, 200);
    assert.equal(allowedComputerPreview.body, "null");

    const wrongOrigin = await requestWithHost(address.port, "/api/operations", {
      method: "DELETE",
      host: "chatroom.example.com",
      headers: { cookie, origin: "https://evil.example.com" },
    });
    assert.equal(wrongOrigin.status, 403);

    const sameOrigin = await requestWithHost(address.port, "/api/operations", {
      method: "DELETE",
      host: "chatroom.example.com",
      headers: { cookie, origin: "https://chatroom.example.com" },
    });
    assert.equal(sameOrigin.status, 200);
  } finally {
    await runtime.cleanup();
  }
});
