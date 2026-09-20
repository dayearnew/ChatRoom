import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createApplication } from "../../src/app/application.js";
import { ExternalAccessRegistry } from "../../src/app/external-access-registry.js";
import { defaultConfig } from "../../src/config/load-config.js";
import { FileLogStore } from "../../src/infrastructure/logging/file-log-store.js";
import { SystemLog } from "../../src/infrastructure/logging/system-log.js";
import { CloudController } from "../../src/plugins/cloud/controller.js";
import { CloudStateStore } from "../../src/plugins/cloud/state-store.js";
import { CLOUD_LEASE_SCHEMA } from "../../src/plugins/cloud/types.js";
import {
  CloudTunnelClient,
  parseTunnelControlMessage,
} from "../../src/plugins/cloud/tunnel-client.js";

test("CloudController serializes concurrent status mutations", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "chatroom-cloud-serial-"));
  const logs = createLogs(dir);
  try {
    const config = defaultConfig();
    config.dataDir = dir;
    config.databasePath = path.join(dir, "chatroom.sqlite");
    const controller = await CloudController.create(
      config,
      logs,
      new ExternalAccessRegistry(config.auth),
    );
    let active = 0;
    let maximumActive = 0;
    let calls = 0;
    Object.assign(controller, {
      api: {
        async status() {
          calls += 1;
          active += 1;
          maximumActive = Math.max(maximumActive, active);
          await new Promise((resolve) => setTimeout(resolve, 15));
          active -= 1;
          return {
            managementSessionActive: false,
            entitlements: [],
            customer: null,
            publicPrefix: null,
          };
        },
      },
    });

    await Promise.all([
      controller.syncStatus(),
      controller.syncStatus(),
      controller.syncStatus(),
    ]);
    assert.equal(calls, 3);
    assert.equal(maximumActive, 1);
    await controller.stop();
  } finally {
    await logs.flush();
    await rm(dir, { recursive: true, force: true });
  }
});

test("Cloud network startup failure keeps automatic retry", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "chatroom-cloud-retry-"));
  const logs = createLogs(dir);
  try {
    const config = defaultConfig();
    config.dataDir = dir;
    config.databasePath = path.join(dir, "chatroom.sqlite");
    const controller = await CloudController.create(
      config,
      logs,
      new ExternalAccessRegistry(config.auth),
    );
    Object.assign(controller, {
      api: {
        async status() {
          throw new Error("network unavailable");
        },
      },
    });

    await controller.start();
    assert.equal(controller.status().connection, "error");
    assert.notEqual(
      (controller as unknown as { statusRetryTimer: NodeJS.Timeout | null })
        .statusRetryTimer,
      null,
    );
    await controller.stop();
  } finally {
    await logs.flush();
    await rm(dir, { recursive: true, force: true });
  }
});

test("Cloud state failure degrades without aborting application startup", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "chatroom-cloud-degraded-"));
  const workspace = path.join(dir, "workspace");
  await mkdir(workspace);
  await writeFile(path.join(dir, "cloud.json"), "{not-json\n");

  const config = defaultConfig();
  config.allowedRoots = [workspace];
  config.dataDir = dir;
  config.databasePath = path.join(dir, "chatroom.sqlite");

  let components: Awaited<ReturnType<typeof createApplication>> | null = null;
  try {
    components = await createApplication(config, createLogs(dir));
    assert.equal(components.cloud.status().connection, "error");
    assert.equal(components.cloud.status().installationId, null);
    assert.match(
      components.cloud.status().lastError ?? "",
      /Cloud state unavailable/,
    );
    assert.deepEqual(components.processes.list(), []);
    await components.cloud.start();
    assert.equal(components.cloud.status().connection, "error");
    assert.equal(
      (
        components.cloud as unknown as {
          statusRetryTimer: NodeJS.Timeout | null;
        }
      ).statusRetryTimer,
      null,
    );

    await rm(path.join(dir, "cloud.json"), { force: true });
    Object.assign(components.cloud, {
      api: {
        async status() {
          return {
            managementSessionActive: false,
            entitlements: [],
            customer: null,
            publicPrefix: null,
          };
        },
      },
    });
    const recovered = await components.cloud.syncStatus();
    assert.equal(recovered.connection, "inactive");
    assert.equal(typeof recovered.installationId, "string");
  } finally {
    if (components) {
      await components.plugins.stop().catch(() => undefined);
      components.database.close();
      await components.logs.flush().catch(() => undefined);
    }
    await rm(dir, { recursive: true, force: true });
  }
});

test("CloudStateStore removes sensitive temporary files after failed rename", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "chatroom-cloud-store-"));
  try {
    const store = new CloudStateStore(dir);
    const state = await store.loadOrCreate();
    await rm(store.filePath, { force: true });
    await mkdir(store.filePath);

    await assert.rejects(store.save(state));
    const entries = await readdir(dir);
    assert.equal(
      entries.some((entry) => entry.endsWith(".tmp")),
      false,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("Cloud lease URLs require their expected protocols", () => {
  const base = {
    token: "lease-token",
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    tunnelUrl: "wss://tunnel.example.com",
    mcpBaseUrl: "https://mcp.example.com",
    webBaseUrl: "https://web.example.com",
    services: ["remote_mcp", "remote_web"],
  };
  assert.doesNotThrow(() => CLOUD_LEASE_SCHEMA.parse(base));
  assert.throws(() =>
    CLOUD_LEASE_SCHEMA.parse({ ...base, tunnelUrl: "https://example.com" }),
  );
  assert.throws(() =>
    CLOUD_LEASE_SCHEMA.parse({ ...base, webBaseUrl: "file:///tmp/web" }),
  );
  assert.throws(() =>
    CLOUD_LEASE_SCHEMA.parse({
      ...base,
      webBaseUrl: null,
      services: ["remote_web"],
    }),
  );
});

test("Cloud tunnel pins forwarded Host to the leased public origin", async () => {
  let resolveHost!: (host: string | undefined) => void;
  const receivedHost = new Promise<string | undefined>((resolve) => {
    resolveHost = resolve;
  });
  const server = createServer((request, response) => {
    resolveHost(request.headers.host);
    response.statusCode = 204;
    response.end();
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address() as AddressInfo;
  const lease = CLOUD_LEASE_SCHEMA.parse({
    token: "lease-token",
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    tunnelUrl: "wss://tunnel.example.com",
    mcpBaseUrl: null,
    webBaseUrl: "https://web.example.com",
    services: ["remote_web"],
  });
  const client = new CloudTunnelClient(
    lease,
    { devicePrivateKey: "unused" },
    { host: "127.0.0.1", port: address.port },
    {
      onConnected() {},
      onDisconnected() {},
      onError() {},
    },
  );

  try {
    const internal = client as unknown as {
      openStream(message: {
        type: "open";
        streamId: number;
        service: "web";
        method: string;
        path: string;
        headers: Record<string, string>;
      }): void;
      handleControl(message: { type: "end"; streamId: number }): void;
    };
    internal.openStream({
      type: "open",
      streamId: 1,
      service: "web",
      method: "GET",
      path: "/api/runtime",
      headers: { host: "localhost" },
    });
    internal.handleControl({ type: "end", streamId: 1 });
    assert.equal(await receivedHost, "web.example.com");
  } finally {
    client.stop();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("Cloud tunnel control messages are validated before use", () => {
  assert.deepEqual(
    parseTunnelControlMessage(
      JSON.stringify({
        type: "open",
        streamId: 7,
        service: "web",
        method: "GET",
        path: "/api/runtime",
        headers: { accept: "application/json" },
      }),
    ),
    {
      type: "open",
      streamId: 7,
      service: "web",
      method: "GET",
      path: "/api/runtime",
      headers: { accept: "application/json" },
    },
  );
  assert.throws(() =>
    parseTunnelControlMessage(
      JSON.stringify({
        type: "open",
        streamId: -1,
        service: "admin",
        method: "GET",
        path: "/",
        headers: {},
      }),
    ),
  );
  assert.throws(() =>
    parseTunnelControlMessage(
      JSON.stringify({ type: "ready", unexpected: true }),
    ),
  );
});

function createLogs(dataDir: string): SystemLog {
  return new SystemLog(new FileLogStore(dataDir));
}
