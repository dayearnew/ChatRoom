import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { defaultConfig, loadConfig } from "../../src/config/load-config.js";
import { ChatRoomError } from "../../src/core/errors/chatroom-error.js";

test("remote binding cannot run without authentication", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "chatroom-config-"));
  const file = path.join(dir, "config.json");
  try {
    const config = defaultConfig();
    config.allowedRoots = [dir];
    config.server.host = "0.0.0.0";
    config.auth.localWebAuth = false;
    await writeFile(file, JSON.stringify(config));
    await assert.rejects(
      loadConfig(file),
      (error: unknown) =>
        error instanceof ChatRoomError && error.code === "FORBIDDEN",
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("public base URLs must be HTTP(S) origins", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "chatroom-config-url-"));
  const file = path.join(dir, "config.json");
  try {
    for (const value of [
      "file://chatroom.example.com/",
      "https://chatroom.example.com/base",
      "https://chatroom.example.com/?mode=remote",
    ]) {
      const config = defaultConfig();
      config.allowedRoots = [dir];
      config.auth.ownerToken = "owner-secret";
      config.auth.mcpPublicBaseUrl = value;
      await writeFile(file, JSON.stringify(config));
      await assert.rejects(
        loadConfig(file),
        (error: unknown) =>
          error instanceof ChatRoomError && error.code === "INVALID_INPUT",
      );
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
