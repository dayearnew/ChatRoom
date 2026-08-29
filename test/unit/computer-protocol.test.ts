import assert from "node:assert/strict";
import test from "node:test";
import {
  nativeError,
  parseNativeEnvelope,
  parseNativeResult,
} from "../../src/plugins/computer/computer-protocol.js";

test("Computer native protocol validates results and maps native errors", () => {
  const status = {
    platform: "macos",
    helper: "running",
    permissions: {
      accessibility: "granted",
      screenRecording: "granted",
    },
    displays: [],
  } as const;
  const envelope = parseNativeEnvelope({
    protocol: 1,
    id: "computer_1",
    result: status,
  });

  assert.deepEqual(parseNativeResult("status", envelope.result), status);
  assert.equal(
    nativeError({ code: "stale_snapshot", message: "stale" }).code,
    "CONFLICT",
  );
  assert.equal(
    nativeError({ code: "permission_required", message: "permission" }).code,
    "FORBIDDEN",
  );
});
