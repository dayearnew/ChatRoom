import assert from "node:assert/strict";
import test from "node:test";
import {
  auditComputerActions,
  auditSnapshotOutput,
} from "../../src/plugins/computer/audit.js";

test("Computer audit never persists typed text or screenshot bytes", () => {
  const actionAudit = auditComputerActions({
    snapshotId: "snap_1",
    observeAfter: true,
    actions: [
      { type: "type_text", text: "SUPER_SECRET_PASSWORD" },
      { type: "set_value", elementId: 4, value: "PRIVATE_TOKEN" },
    ],
  });
  const snapshotAudit = auditSnapshotOutput({
    snapshotId: "snap_1",
    revision: 1,
    display: null,
    activeApp: "Example",
    activeWindow: "Window",
    cursor: null,
    elements: [],
    screenshot: {
      mimeType: "image/jpeg",
      data: "PRIVATE_SCREENSHOT_DATA",
    },
  });

  const persisted = JSON.stringify({ actionAudit, snapshotAudit });
  assert.equal(persisted.includes("SUPER_SECRET_PASSWORD"), false);
  assert.equal(persisted.includes("PRIVATE_TOKEN"), false);
  assert.equal(persisted.includes("PRIVATE_SCREENSHOT_DATA"), false);
  assert.equal(snapshotAudit.screenshot, true);
});
