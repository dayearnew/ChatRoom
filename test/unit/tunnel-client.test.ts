/** Unit coverage for Cloud tunnel liveness and reconnect behavior. */
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { WebSocketServer, type WebSocket } from "ws";
import { CloudTunnelClient } from "../../src/plugins/cloud/tunnel-client.js";
import type { CloudLeaseState } from "../../src/plugins/cloud/types.js";

function privateKey(): string {
  const { privateKey } = generateKeyPairSync("ed25519");
  return privateKey
    .export({ format: "der", type: "pkcs8" })
    .toString("base64url");
}

async function server(
  onConnection: (socket: WebSocket, connection: number) => void,
): Promise<{ wss: WebSocketServer; url: string }> {
  let connections = 0;
  const wss = new WebSocketServer({ port: 0 });
  wss.on("connection", (socket) => onConnection(socket, ++connections));
  await once(wss, "listening");
  const address = wss.address() as AddressInfo;
  return { wss, url: `ws://127.0.0.1:${address.port}` };
}

function authenticate(socket: WebSocket): void {
  socket.send(JSON.stringify({ type: "challenge", nonce: "test-nonce" }));
  socket.once("message", () => socket.send(JSON.stringify({ type: "ready" })));
}

function lease(tunnelUrl: string): CloudLeaseState {
  return {
    token: "test-lease",
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    tunnelUrl,
    mcpBaseUrl: null,
    webBaseUrl: null,
    services: ["remote_mcp"],
  };
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 2_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline)
      throw new Error("Timed out waiting for condition");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function closeServer(wss: WebSocketServer): Promise<void> {
  for (const socket of wss.clients) socket.terminate();
  await new Promise<void>((resolve, reject) =>
    wss.close((error) => (error ? reject(error) : resolve())),
  );
}

test("tunnel reconnects when heartbeat pong is missing", async () => {
  let connections = 0;
  let connected = 0;
  const errors: string[] = [];
  const { wss, url } = await server((socket, connection) => {
    connections = connection;
    if (connection === 1) {
      // ws automatically answers ping frames. Suppress that response to model a
      // half-open connection whose peer no longer responds.
      socket.pong = () => undefined;
    }
    authenticate(socket);
  });
  const client = new CloudTunnelClient(
    lease(url),
    { devicePrivateKey: privateKey() },
    { host: "127.0.0.1", port: 1 },
    {
      onConnected: () => connected++,
      onDisconnected: () => undefined,
      onError: (error) => errors.push(error.message),
    },
    { heartbeatIntervalMs: 40, readyTimeoutMs: 200 },
  );

  try {
    client.start();
    await waitFor(() => connections >= 2 && connected >= 2);
    assert.ok(errors.includes("Tunnel heartbeat timed out"));
    const stableConnections = connections;
    await new Promise((resolve) => setTimeout(resolve, 120));
    assert.equal(connections, stableConnections);
  } finally {
    client.stop();
    await closeServer(wss);
  }
});

test("tunnel abandons a connection that never becomes ready", async () => {
  let connections = 0;
  let connected = 0;
  const errors: string[] = [];
  const { wss, url } = await server((socket, connection) => {
    connections = connection;
    if (connection > 1) authenticate(socket);
  });
  const client = new CloudTunnelClient(
    lease(url),
    { devicePrivateKey: privateKey() },
    { host: "127.0.0.1", port: 1 },
    {
      onConnected: () => connected++,
      onDisconnected: () => undefined,
      onError: (error) => errors.push(error.message),
    },
    { heartbeatIntervalMs: 1_000, readyTimeoutMs: 40 },
  );

  try {
    client.start();
    await waitFor(() => connections >= 2 && connected >= 1);
    assert.ok(errors.includes("Tunnel connection timed out"));
  } finally {
    client.stop();
    await closeServer(wss);
  }
});

test("stopping after disconnect cancels pending reconnect", async () => {
  let connections = 0;
  let client!: CloudTunnelClient;
  const { wss, url } = await server((socket, connection) => {
    connections = connection;
    authenticate(socket);
    socket.once("message", () => setTimeout(() => socket.close(), 10));
  });
  client = new CloudTunnelClient(
    lease(url),
    { devicePrivateKey: privateKey() },
    { host: "127.0.0.1", port: 1 },
    {
      onConnected: () => undefined,
      onDisconnected: () => client.stop(),
      onError: () => undefined,
    },
    { heartbeatIntervalMs: 1_000, readyTimeoutMs: 200 },
  );

  try {
    client.start();
    await waitFor(() => connections === 1);
    await new Promise((resolve) => setTimeout(resolve, 700));
    assert.equal(connections, 1);
  } finally {
    client.stop();
    await closeServer(wss);
  }
});
