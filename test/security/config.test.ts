/** Core configuration security coverage for authenticated remote binding. */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { defaultConfig, loadConfig } from "../../src/config/load-config.js";
import { platformPaths } from "../../src/config/platform-paths.js";
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

test("platform paths follow operating-system conventions", () => {
  assert.deepEqual(platformPaths("linux", {}, "/home/alice"), {
    configFile: "/home/alice/.config/chatroom/config.json",
    dataDir: "/home/alice/.local/share/chatroom",
    databaseFile: "/home/alice/.local/state/chatroom/chatroom.sqlite",
  });
  assert.deepEqual(
    platformPaths(
      "linux",
      {
        XDG_CONFIG_HOME: "/cfg",
        XDG_DATA_HOME: "/data",
        XDG_STATE_HOME: "/state",
      },
      "/home/alice",
    ),
    {
      configFile: "/cfg/chatroom/config.json",
      dataDir: "/data/chatroom",
      databaseFile: "/state/chatroom/chatroom.sqlite",
    },
  );
  assert.deepEqual(platformPaths("darwin", {}, "/Users/alice"), {
    configFile: "/Users/alice/Library/Application Support/ChatRoom/config.json",
    dataDir: "/Users/alice/Library/Application Support/ChatRoom/Data",
    databaseFile:
      "/Users/alice/Library/Application Support/ChatRoom/State/chatroom.sqlite",
  });
  assert.deepEqual(
    platformPaths(
      "win32",
      { APPDATA: "C:\\Roaming", LOCALAPPDATA: "C:\\Local" },
      "C:\\Users\\alice",
    ),
    {
      configFile: "C:\\Roaming\\ChatRoom\\config.json",
      dataDir: "C:\\Local\\ChatRoom\\Data",
      databaseFile: "C:\\Local\\ChatRoom\\State\\chatroom.sqlite",
    },
  );
});
