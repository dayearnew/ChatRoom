/** Unit coverage for redacted and bounded plugin operation persistence. */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AppDatabase } from "../../src/infrastructure/database/app-database.js";
import { OperationRepository } from "../../src/infrastructure/database/operation-repository.js";
import { RuntimeEventBus } from "../../src/app/event-bus.js";
import { OperationLog } from "../../src/operations/operation-log.js";

test("operation log stores plugin attribution with redacted and bounded values", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "chatroom-operations-"));
  const db = new AppDatabase(path.join(dir, "operations.sqlite"));
  try {
    const repository = new OperationRepository(db);
    const operations = new OperationLog(repository, new RuntimeEventBus(), 512);
    const event = operations.start({
      pluginId: "workspace",
      source: "mcp",
      action: "test",
      input: { token: "raw-token", content: "A".repeat(2000) },
    });
    operations.finish(event.operationId, "success", {
      password: "raw-password",
      output: "B".repeat(2000),
    });
    const stored = repository.get(event.operationId)!;
    assert.equal(stored.pluginId, "workspace");
    assert.equal(stored.source, "mcp");
    const serialized = JSON.stringify(stored);
    assert.equal(serialized.includes("raw-token"), false);
    assert.equal(serialized.includes("raw-password"), false);
    assert.equal(stored.inputTruncated, true);
    assert.equal(stored.outputTruncated, true);
  } finally {
    db.close();
    await rm(dir, { recursive: true, force: true });
  }
});
