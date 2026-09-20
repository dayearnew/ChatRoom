import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { FileLogStore } from "../../src/infrastructure/logging/file-log-store.js";
import { SystemLog } from "../../src/infrastructure/logging/system-log.js";
import { SecretRedactor } from "../../src/core/operations/redactor.js";

test("SystemLog persists redacted JSONL and filters history", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "chatroom-system-log-"));
  try {
    const store = new FileLogStore(dir);
    const logs = new SystemLog(store);
    const shared = { value: "shared" };
    logs.info("auth", "auth.success", "Authentication succeeded", {
      method: "owner_token",
      token: "do-not-persist-this",
      first: shared,
      second: shared,
    });
    logs.warn("cloud", "cloud.disconnected", "Cloud tunnel disconnected");
    await logs.flush();
    await store.append({
      id: "large-record",
      timestamp: new Date(Date.now() + 1_000).toISOString(),
      level: "debug",
      module: "app",
      event: "app.large",
      message: "x".repeat(70_000),
    });

    const raw = await readFile(store.filePath, "utf8");
    assert.doesNotMatch(raw, /do-not-persist-this/);
    assert.match(raw, /\[redacted\]/);

    const page = await logs.list({
      limit: 10,
      levels: new Set(["info"]),
      modules: new Set(["auth"]),
    });
    assert.equal(page.items.length, 1);
    assert.equal(page.items[0]?.event, "auth.success");
    assert.equal(page.items[0]?.data?.token, "[redacted]");
    assert.deepEqual(page.items[0]?.data?.first, { value: "shared" });
    assert.deepEqual(page.items[0]?.data?.second, { value: "shared" });
    assert.equal(page.nextCursor, null);

    const firstPage = await logs.list({ limit: 1 });
    assert.equal(firstPage.items[0]?.id, "large-record");
    assert.ok(firstPage.nextCursor);
    const secondPage = await logs.list({
      limit: 1,
      cursor: firstPage.nextCursor,
    });
    assert.equal(secondPage.items[0]?.event, "cloud.disconnected");

    const sharedRedacted = { value: "safe" };
    assert.deepEqual(
      new SecretRedactor().redact({
        first: sharedRedacted,
        second: sharedRedacted,
      }),
      {
        first: { value: "safe" },
        second: { value: "safe" },
      },
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
