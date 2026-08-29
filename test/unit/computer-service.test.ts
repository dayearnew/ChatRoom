import assert from "node:assert/strict";
import test from "node:test";
import { RuntimeEventBus } from "../../src/app/event-bus.js";
import { ChatRoomError } from "../../src/core/errors/chatroom-error.js";
import { ComputerService } from "../../src/plugins/computer/computer-service.js";
import type {
  ComputerBackend,
  ComputerSettings,
  ComputerSnapshot,
} from "../../src/plugins/computer/types.js";

function fixture() {
  let settings: ComputerSettings = {
    enabled: true,
    remoteAccess: true,
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
  let actionCount = 0;
  let disposeCount = 0;
  const snapshot: ComputerSnapshot = {
    snapshotId: "snap_1",
    revision: 0,
    display: null,
    activeApp: null,
    activeWindow: null,
    cursor: null,
    elements: [],
  };
  const backend: ComputerBackend = {
    async status() {
      return {
        platform: "macos",
        helper: "running",
        permissions: {
          accessibility: "granted",
          screenRecording: "granted",
        },
        displays: [],
      };
    },
    async requestPermission() {
      return this.status();
    },
    async snapshot(_request, revision) {
      return { ...snapshot, revision };
    },
    async action(_request, revision) {
      actionCount += 1;
      return {
        success: true,
        revision,
        executionMode: "background",
        focusChanged: false,
      };
    },
    async dispose() {
      disposeCount += 1;
    },
  };
  const store = {
    get: () => ({ ...settings }),
    set(value: ComputerSettings) {
      settings = { ...value, updatedAt: new Date().toISOString() };
      return { ...settings };
    },
  };
  return {
    service: new ComputerService(backend, store, new RuntimeEventBus()),
    actionCount: () => actionCount,
    disposeCount: () => disposeCount,
  };
}

test("Computer snapshot IDs scope element actions to the latest observation", async () => {
  const item = fixture();

  await assert.rejects(
    item.service.action("local", {
      actions: [{ type: "click", elementId: 1 }],
      observeAfter: false,
    }),
    (error) => error instanceof ChatRoomError && error.code === "CONFLICT",
  );

  const snapshot = await item.service.snapshot("local", {
    includeScreenshot: false,
    includeElements: true,
  });
  await item.service.action("local", {
    snapshotId: snapshot.snapshotId,
    actions: [{ type: "click", elementId: 1 }],
    observeAfter: false,
  });
  assert.equal(item.actionCount(), 1);

  await assert.rejects(
    item.service.action("local", {
      snapshotId: snapshot.snapshotId,
      actions: [{ type: "click", elementId: 1 }],
      observeAfter: false,
    }),
    (error) => error instanceof ChatRoomError && error.code === "CONFLICT",
  );
});

test("Computer bounds action duration and releases native state when disabled", async () => {
  const item = fixture();

  await assert.rejects(
    item.service.action("local", {
      actions: [
        { type: "wait", ms: 30_000 },
        {
          type: "drag",
          from: { x: 0, y: 0 },
          to: { x: 1, y: 1 },
          durationMs: 1,
        },
      ],
      observeAfter: false,
    }),
    (error) => error instanceof ChatRoomError && error.code === "INVALID_INPUT",
  );

  await item.service.snapshot("local", {
    includeScreenshot: false,
    includeElements: false,
  });
  item.service.setSettings({ enabled: false });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(item.service.latestSnapshot("local"), null);
  assert.equal(item.disposeCount(), 1);
});
