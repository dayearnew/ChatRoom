import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ChatRoomConfig } from "../../src/config/types.js";
import { createApplication } from "../../src/app/application.js";

test("startup reconciles operations left running by a previous instance", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "chatroom-recovery-"));
  const workspaceRoot = path.join(root, "workspace");
  const dataDir = path.join(root, "data");
  await mkdir(workspaceRoot, { recursive: true });
  const config: ChatRoomConfig = {
    allowedRoots: [root],
    dataDir,
    databasePath: path.join(dataDir, "chatroom.sqlite"),
    server: { host: "127.0.0.1", port: 0 },
    auth: {
      localWebAuth: false,
      ownerToken: "test-owner-token",
      mcpPublicBaseUrl: null,
      webPublicBaseUrl: null,
      allowedRedirectHosts: ["localhost", "127.0.0.1"],
    },
    operations: { maxPayloadBytes: 16 * 1024 },
    process: {
      maxOutputBytes: 16 * 1024,
      defaultTimeoutMs: 10_000,
      maxCompletedProcesses: 50,
    },
  };

  const first = await createApplication(config);
  const running = first.operations.start({
    pluginId: "workspace",
    source: "mcp",
    action: "test.interrupted",
  });
  first.database.close();

  const second = await createApplication(config);
  try {
    assert.equal(
      second.operations.get(running.operationId)?.status,
      "cancelled",
    );
  } finally {
    await second.processes.shutdown();
    await second.http.close().catch(() => undefined);
    second.database.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("persisted workspace is rejected if its path is replaced by a symlink outside allowed roots", async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "chatroom-workspace-root-"),
  );
  const outside = await mkdtemp(
    path.join(os.tmpdir(), "chatroom-workspace-outside-"),
  );
  const workspaceRoot = path.join(root, "workspace");
  const dataDir = path.join(root, "data");
  await mkdir(workspaceRoot, { recursive: true });
  const config: ChatRoomConfig = {
    allowedRoots: [root],
    dataDir,
    databasePath: path.join(dataDir, "chatroom.sqlite"),
    server: { host: "127.0.0.1", port: 0 },
    auth: {
      localWebAuth: false,
      ownerToken: "test-owner-token",
      mcpPublicBaseUrl: null,
      webPublicBaseUrl: null,
      allowedRedirectHosts: ["localhost", "127.0.0.1"],
    },
    operations: { maxPayloadBytes: 16 * 1024 },
    process: {
      maxOutputBytes: 16 * 1024,
      defaultTimeoutMs: 10_000,
      maxCompletedProcesses: 50,
    },
  };

  const first = await createApplication(config);
  const workspace = await first.application.workspaces.open({
    path: workspaceRoot,
  });
  await first.processes.shutdown();
  first.database.close();
  await rm(workspaceRoot, { recursive: true, force: true });
  await symlink(outside, workspaceRoot);

  const second = await createApplication(config);
  try {
    assert.equal(
      second.application.workspaces
        .list()
        .some((item) => item.id === workspace.id),
      false,
    );
    assert.equal(
      second.database.raw
        .prepare("SELECT COUNT(*) AS count FROM workspaces WHERE id=?")
        .get(workspace.id)!.count,
      0,
    );
  } finally {
    await second.processes.shutdown();
    await second.http.close().catch(() => undefined);
    second.database.close();
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});
