import assert from "node:assert/strict";
import test from "node:test";
import { createTestRuntime, waitForProcess } from "../helpers/runtime.js";

test("process timeout terminates the process", async () => {
  const runtime = await createTestRuntime();
  try {
    const started = await runtime.components.processes.start(
      {
        cwd: runtime.workspaceRoot,
        command: process.execPath,
        args: ["-e", "setTimeout(()=>{},5000)"],
        timeoutMs: 50,
      },
      { source: "mcp" },
    );
    const result = await waitForProcess(
      runtime.components.processes,
      started.processId,
    );
    assert.equal(result.timedOut, true);
    assert.notEqual(result.state, "running");
  } finally {
    await runtime.cleanup();
  }
});

test(
  "PTY backend runs through ProcessSupervisor on Linux",
  { skip: process.platform !== "linux" },
  async () => {
    const runtime = await createTestRuntime();
    try {
      const started = await runtime.components.processes.start(
        {
          cwd: runtime.workspaceRoot,
          command: process.execPath,
          args: ["-e", "process.stdout.write('pty-ok')"],
          pty: true,
          timeoutMs: 5000,
        },
        { source: "mcp" },
      );
      const result = await waitForProcess(
        runtime.components.processes,
        started.processId,
      );
      assert.equal(result.exitCode, 0);
      assert.match(result.stdout, /pty-ok/);
    } finally {
      await runtime.cleanup();
    }
  },
);

test("supervised processes do not inherit arbitrary server secrets", async () => {
  const runtime = await createTestRuntime();
  const previous = process.env.CHATROOM_TEST_SECRET;
  process.env.CHATROOM_TEST_SECRET = "must-not-leak";
  try {
    const started = await runtime.components.processes.start(
      {
        cwd: runtime.workspaceRoot,
        command: process.execPath,
        args: [
          "-e",
          "process.stdout.write(JSON.stringify({secret:process.env.CHATROOM_TEST_SECRET??null,path:Boolean(process.env.PATH)}))",
        ],
      },
      { source: "mcp" },
    );
    const result = await waitForProcess(
      runtime.components.processes,
      started.processId,
    );
    assert.equal(result.exitCode, 0);
    assert.deepEqual(JSON.parse(result.stdout), { secret: null, path: true });
  } finally {
    if (previous === undefined) delete process.env.CHATROOM_TEST_SECRET;
    else process.env.CHATROOM_TEST_SECRET = previous;
    await runtime.cleanup();
  }
});

test(
  "shutdown force-kills a SIGTERM-resistant process",
  { skip: process.platform === "win32" },
  async () => {
    const runtime = await createTestRuntime();
    try {
      const started = await runtime.components.processes.start(
        {
          cwd: runtime.workspaceRoot,
          command: process.execPath,
          args: [
            "-e",
            "process.on('SIGTERM',()=>{});process.stdout.write('ready');setInterval(()=>{},1000)",
          ],
        },
        { source: "mcp" },
      );
      await new Promise((resolve) => setTimeout(resolve, 100));
      await runtime.components.processes.shutdown();
      const settled = runtime.components.processes.read(started.processId);
      assert.notEqual(settled.state, "running");
      assert.equal(settled.signal, "SIGKILL");
      assert.notEqual(
        runtime.components.operations.get(started.operationId)?.status,
        "running",
      );
    } finally {
      await runtime.cleanup();
    }
  },
);
