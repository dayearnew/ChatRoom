import assert from "node:assert/strict";
import test from "node:test";
import { ComputerNativeHost } from "../../src/plugins/computer/computer-native-host.js";
import { parseNativeEnvelope } from "../../src/plugins/computer/computer-protocol.js";

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

test("Computer native responses require the current protocol version", () => {
  assert.throws(() =>
    parseNativeEnvelope({
      id: "response-1",
      result: {},
    }),
  );
  assert.equal(
    parseNativeEnvelope({
      protocol: 1,
      id: "response-1",
      result: {},
    }).id,
    "response-1",
  );
  assert.throws(() =>
    parseNativeEnvelope({
      protocol: 1,
      id: "response-1",
      result: {},
      error: { message: "ambiguous" },
    }),
  );
  assert.throws(() =>
    parseNativeEnvelope({
      protocol: 1,
      id: "response-1",
      result: {},
      unexpected: true,
    }),
  );
});
