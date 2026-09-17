import assert from "node:assert/strict";
import test from "node:test";
import { ComputerNativeHost } from "../../src/plugins/computer/computer-native-host.js";

test("ComputerNativeHost rejects a helper start superseded by restart", async () => {
  const host = new ComputerNativeHost();
  let release!: () => void;
  const internal = host as unknown as {
    startHelper(platform: string, generation: number): Promise<void>;
    ensureStarted(): Promise<void>;
  };
  internal.startHelper = async () =>
    await new Promise<void>((resolve) => {
      release = resolve;
    });

  const starting = internal.ensureStarted();
  host.restart("test restart");
  release();

  await assert.rejects(starting, /superseded/);
  await host.dispose();
});
