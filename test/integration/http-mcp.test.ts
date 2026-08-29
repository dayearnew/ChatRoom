/** Verifies that HTTP and a real MCP client operate against the same plugin runtime. */
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
    assert.ok(tools.tools.some((tool) => tool.name === "open_workspace"));
    assert.ok(tools.tools.some((tool) => tool.name === "fs_patch"));
    assert.ok(tools.tools.some((tool) => tool.name === "computer_snapshot"));
    assert.ok(tools.tools.some((tool) => tool.name === "computer_action"));
    assert.equal(
      tools.tools.every((tool) => Boolean(tool.outputSchema)),
      true,
      "every public MCP tool should advertise a structured output schema",
    );
    assert.equal(
      tools.tools.every((tool) => Boolean(tool.annotations)),
      true,
      "every public MCP tool should advertise behavior annotations",
    );
    const readFile = tools.tools.find((tool) => tool.name === "fs_read");
    assert.deepEqual(readFile?.annotations, {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
    const writeFile = tools.tools.find((tool) => tool.name === "fs_write");
    assert.deepEqual(writeFile?.annotations, {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    });
    const startProcess = tools.tools.find(
      (tool) => tool.name === "process_start",
    );
    assert.deepEqual(startProcess?.annotations, {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    });
    assert.equal(
      "workspaceId" in
        ((startProcess?.outputSchema?.properties ?? {}) as object),
      false,
    );
    const openWorkspace = tools.tools.find(
      (tool) => tool.name === "open_workspace",
    );
    const workspaceCapabilities = (
      openWorkspace?.outputSchema?.properties as
        Record<string, unknown> | undefined
    )?.capabilities as { properties?: Record<string, unknown> } | undefined;
    assert.equal("process" in (workspaceCapabilities?.properties ?? {}), false);
    const opened = await client.callTool({
      name: "open_workspace",
      arguments: { path: runtime.workspaceRoot },
    });
    assert.equal(opened.isError, undefined);
    const structured = opened.structuredContent as { id: string };
    assert.match(structured.id, /^ws_/);
    const written = await client.callTool({
      name: "fs_write",
      arguments: {
        workspaceId: structured.id,
        path: "mcp.txt",
        content: "from mcp",
      },
    });
    assert.equal(written.isError, undefined);
    const listed = await client.callTool({
      name: "fs_list",
      arguments: { workspaceId: structured.id, path: ".", recursive: false },
    });
    assert.ok(
      Array.isArray((listed.structuredContent as { files?: unknown[] }).files),
    );
    const operations = (await fetch(`${base}/api/operations?limit=100`).then(
      (response) => response.json(),
    )) as Array<{ source: string; action: string }>;
    assert.ok(
      operations.some(
        (event) => event.source === "mcp" && event.action === "fs.write",
      ),
    );
    const detailed = runtime.components.operations.list({ limit: 100 });
    const writes = detailed.filter(
      (operation) =>
        operation.pluginId === "workspace" &&
        operation.source === "mcp" &&
        operation.action === "fs.write",
    );
    assert.equal(
      writes.length,
      1,
      "fs_write should produce one Workspace operation",
    );
    assert.equal(
      detailed.some((operation) => operation.action.startsWith("mcp.")),
      false,
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
    assert.equal(
      runtime.components.operations
        .list({ limit: 100 })
        .filter(
          (operation) =>
            operation.pluginId === "process" && operation.action === "start",
        ).length,
      1,
      "process_start should reuse the framework-created operation",
    );
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
