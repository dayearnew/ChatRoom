import assert from "node:assert/strict";
import test from "node:test";
import { PluginManager } from "../../src/plugins/plugin-manager.js";
import type { LogWriter } from "../../src/core/logging/types.js";
import type { InternalPlugin, PluginContext } from "../../src/plugins/types.js";

test("PluginManager rolls back all activated plugins when startup fails", async () => {
  const events: string[] = [];
  const plugin = (id: string, fail = false): InternalPlugin => ({
    id,
    activate() {
      events.push(`start:${id}`);
      if (fail) throw new Error(`failed:${id}`);
    },
    deactivate() {
      events.push(`stop:${id}`);
    },
  });
  const manager = new PluginManager(testContext(), [
    plugin("first"),
    plugin("second", true),
  ]);

  await assert.rejects(manager.start(), /failed:second/);
  assert.deepEqual(events, [
    "start:first",
    "start:second",
    "stop:second",
    "stop:first",
  ]);
});

test("PluginManager attempts every deactivate even when one fails", async () => {
  const stopped: string[] = [];
  const plugins: InternalPlugin[] = ["first", "second", "third"].map((id) => ({
    id,
    activate() {},
    deactivate() {
      stopped.push(id);
      if (id === "second") throw new Error("stop failed");
    },
  }));
  const manager = new PluginManager(testContext(), plugins);

  await manager.start();
  await assert.rejects(manager.stop(), /stop failed/);
  assert.deepEqual(stopped, ["third", "second", "first"]);
});

function testContext(): PluginContext {
  const logs: LogWriter = {
    debug() {},
    info() {},
    warn() {},
    error() {},
  };
  return { logs } as PluginContext;
}
