import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { SystemLogReader } from "../../src/infrastructure/logging/log-reader.js";
import { SystemLogger } from "../../src/infrastructure/logging/logger.js";

test("SystemLogger writes redacted JSONL that SystemLogReader can filter", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "chatroom-system-log-"));
  try {
    const logger = new SystemLogger(dir);
    logger.info("auth", "auth.success", "Authentication succeeded", {
      method: "owner_token",
      token: "do-not-persist-this",
    });
    logger.warn("cloud", "cloud.disconnected", "Cloud tunnel disconnected");
    await logger.flush();

    const raw = await readFile(logger.filePath, "utf8");
    assert.doesNotMatch(raw, /do-not-persist-this/);
    assert.match(raw, /\[redacted\]/);

    const reader = new SystemLogReader(logger.filePath);
    const page = await reader.list({
      limit: 10,
      levels: new Set(["info"]),
      modules: new Set(["auth"]),
    });
    assert.equal(page.items.length, 1);
    assert.equal(page.items[0]?.event, "auth.success");
    assert.equal(page.items[0]?.data?.token, "[redacted]");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
