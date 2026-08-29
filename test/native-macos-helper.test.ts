import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { ChatRoomError } from "../src/core/errors/chatroom-error.js";
import { NativeComputerBackend } from "../src/plugins/computer/computer-native-backend.js";

const appPath = path.resolve("dist/native/macos/ChatRoomComputerHelper.app");
const helperPath = path.join(
  appPath,
  "Contents/MacOS/chatroom-computer-helper",
);

test(
  "signed macOS helper performs core Computer Use operations",
  { timeout: 30_000 },
  async (t) => {
    assert.equal(process.platform, "darwin");
    verifySignedHelper();

    const backend = new NativeComputerBackend();
    t.after(() => backend.dispose());

    const status = await backend.status();
    assert.equal(status.platform, "macos");
    assert.equal(status.permissions.accessibility, "granted");
    assert.equal(status.permissions.screenRecording, "granted");
    assert.ok(status.displays.length > 0);

    const desktop = await backend.snapshot(
      { includeScreenshot: true, includeElements: true },
      1,
    );
    assertJpeg(desktop.screenshot?.data);
    assert.ok(desktop.elements.length > 0);
    assert.ok(desktop.activeApp);

    const window = desktop.elements.find(
      (element) => element.role === "window",
    );
    assert.ok(window);
    const current = await backend.snapshot(
      {
        target: { type: "window", elementId: window.id },
        includeScreenshot: true,
        includeElements: true,
      },
      2,
    );
    assertJpeg(current.screenshot?.data);

    await assert.rejects(
      backend.action(
        {
          snapshotId: desktop.snapshotId,
          actions: [{ type: "click", elementId: window.id }],
          observeAfter: false,
        },
        3,
      ),
      (error) => error instanceof ChatRoomError && error.code === "CONFLICT",
    );

    const cursor = current.cursor ?? { x: 0, y: 0 };
    const action = await backend.action(
      {
        snapshotId: current.snapshotId,
        actions: [{ type: "move", x: cursor.x, y: cursor.y }],
        observeAfter: true,
      },
      3,
    );
    assert.equal(action.success, true);
    assertJpeg(action.snapshot?.screenshot?.data);
  },
);

function verifySignedHelper(): void {
  const verify = spawnSync(
    "/usr/bin/codesign",
    ["--verify", "--deep", "--strict", appPath],
    { encoding: "utf8" },
  );
  assert.equal(verify.status, 0, verify.stderr);

  const details = spawnSync(
    "/usr/bin/codesign",
    ["-dv", "--verbose=4", helperPath],
    { encoding: "utf8" },
  );
  assert.equal(details.status, 0, details.stderr);
  assert.match(details.stderr, /Identifier=com\.chatroomcp\.computer/);
  assert.doesNotMatch(details.stderr, /Signature=adhoc/);
  assert.match(details.stderr, /Authority=/);
}

function assertJpeg(base64: string | undefined): void {
  assert.ok(base64);
  const data = Buffer.from(base64, "base64");
  assert.ok(data.length > 1024);
  assert.deepEqual([...data.subarray(0, 2)], [0xff, 0xd8]);
}
