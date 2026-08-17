import assert from "node:assert/strict";
import test from "node:test";
import { createTestRuntime } from "../helpers/runtime.js";
import { CommandRunner } from "../../src/core/runtime/command-runner.js";

async function run(
  runtime: Awaited<ReturnType<typeof createTestRuntime>>,
  workspaceId: string,
  args: string[],
) {
  const workspace = runtime.components.application.workspaces.get(workspaceId);
  return new CommandRunner().run({
    command: "git",
    args,
    cwd: workspace.root,
    timeoutMs: 10_000,
  });
}

async function open(
  runtime: Awaited<ReturnType<typeof createTestRuntime>>,
  request: { path: string; mode?: "checkout" | "worktree" },
) {
  return runtime.components.application.workspaces.open(request);
}

async function write(
  runtime: Awaited<ReturnType<typeof createTestRuntime>>,
  workspaceId: string,
  path: string,
  content: string,
) {
  return (
    await runtime.components.application.workspaces.fs(workspaceId)
  ).write(path, content);
}

async function read(
  runtime: Awaited<ReturnType<typeof createTestRuntime>>,
  workspaceId: string,
  path: string,
) {
  return (await runtime.components.application.workspaces.fs(workspaceId)).read(
    path,
  );
}

test("worktree workspace is created as an isolated managed checkout", async () => {
  const runtime = await createTestRuntime();
  try {
    const checkout = await open(runtime, { path: runtime.workspaceRoot });
    await run(runtime, checkout.id, ["init"]);
    await write(runtime, checkout.id, "a.txt", "a\n");
    await write(runtime, checkout.id, "b.txt", "b\n");
    await run(runtime, checkout.id, ["add", "a.txt", "b.txt"]);
    await assert.rejects(
      open(runtime, { path: runtime.workspaceRoot, mode: "worktree" }),
      (error: unknown) => {
        assert.equal((error as { code?: string }).code, "CONFLICT");
        assert.match(
          (error as Error).message,
          /requires at least one Git commit; repository HEAD does not exist/,
        );
        return true;
      },
    );
    await run(runtime, checkout.id, [
      "-c",
      "user.name=ChatRoom Test",
      "-c",
      "user.email=test@example.invalid",
      "commit",
      "-m",
      "base",
    ]);
    const worktree = await open(runtime, {
      path: runtime.workspaceRoot,
      mode: "worktree",
    });
    assert.equal(worktree.mode, "worktree");
    assert.equal(worktree.sourceRoot, checkout.root);
    assert.notEqual(worktree.root, checkout.root);
    assert.equal((await read(runtime, worktree.id, "a.txt")).content, "a\n");
    await write(runtime, worktree.id, "a.txt", "aa\n");
    await write(runtime, worktree.id, "b.txt", "bb\n");
    const initialPreview =
      await runtime.components.application.workspaces.previewWorktreeApply(
        worktree.id,
      );
    assert.equal(initialPreview.pendingFiles, 2);
    assert.equal(initialPreview.appliedFiles, 0);

    await runtime.components.application.workspaces.applyWorktree(worktree.id, [
      "a.txt",
    ]);
    assert.equal((await read(runtime, checkout.id, "a.txt")).content, "aa\n");
    assert.equal((await read(runtime, checkout.id, "b.txt")).content, "b\n");
    const partialPreview =
      await runtime.components.application.workspaces.previewWorktreeApply(
        worktree.id,
      );
    assert.equal(partialPreview.pendingFiles, 1);
    assert.equal(partialPreview.appliedFiles, 1);
    assert.equal(
      partialPreview.files.find((file) => file.path === "a.txt")?.applied,
      true,
    );
    assert.equal(
      partialPreview.files.find((file) => file.path === "b.txt")?.applied,
      false,
    );

    await runtime.components.application.workspaces.applyWorktree(worktree.id, [
      "b.txt",
    ]);
    assert.equal((await read(runtime, checkout.id, "b.txt")).content, "bb\n");
    assert.equal(
      (await run(runtime, checkout.id, ["diff", "--cached"])).stdout,
      "",
    );
    const completePreview =
      await runtime.components.application.workspaces.previewWorktreeApply(
        worktree.id,
      );
    assert.equal(completePreview.pendingFiles, 0);
    assert.equal(completePreview.appliedFiles, 2);
    const second = await open(runtime, {
      path: runtime.workspaceRoot,
      mode: "worktree",
    });
    assert.notEqual(second.id, worktree.id);
  } finally {
    await runtime.cleanup();
  }
});

test("multiple worktrees three-way merge independent changes and preserve real conflicts", async () => {
  const runtime = await createTestRuntime();
  try {
    const checkout = await open(runtime, { path: runtime.workspaceRoot });
    await run(runtime, checkout.id, ["init"]);
    await write(runtime, checkout.id, "shared.txt", "one\ntwo\nthree\nfour\n");
    await write(runtime, checkout.id, "left.txt", "left\n");
    await write(runtime, checkout.id, "right.txt", "right\n");
    await run(runtime, checkout.id, [
      "add",
      "shared.txt",
      "left.txt",
      "right.txt",
    ]);
    await run(runtime, checkout.id, [
      "-c",
      "user.name=ChatRoom Test",
      "-c",
      "user.email=test@example.invalid",
      "commit",
      "-m",
      "base",
    ]);

    const first = await open(runtime, {
      path: runtime.workspaceRoot,
      mode: "worktree",
    });
    const second = await open(runtime, {
      path: runtime.workspaceRoot,
      mode: "worktree",
    });
    const conflicting = await open(runtime, {
      path: runtime.workspaceRoot,
      mode: "worktree",
    });

    await write(runtime, first.id, "left.txt", "LEFT\n");
    await write(runtime, first.id, "shared.txt", "ONE\ntwo\nthree\nfour\n");
    await write(runtime, second.id, "right.txt", "RIGHT\n");
    await write(runtime, second.id, "shared.txt", "one\ntwo\nthree\nFOUR\n");
    await write(
      runtime,
      conflicting.id,
      "shared.txt",
      "OTHER\ntwo\nthree\nfour\n",
    );
    await write(runtime, conflicting.id, "extra.txt", "extra\n");

    await runtime.components.application.workspaces.applyWorktree(first.id);
    const secondPreview =
      await runtime.components.application.workspaces.previewWorktreeApply(
        second.id,
      );
    assert.equal(secondPreview.pendingFiles, 2);
    assert.equal(secondPreview.mergeableFiles, 2);
    assert.equal(secondPreview.conflictFiles, 0);
    assert.equal(secondPreview.canApply, true);

    await runtime.components.application.workspaces.applyWorktree(second.id);
    assert.equal(
      (await read(runtime, checkout.id, "left.txt")).content,
      "LEFT\n",
    );
    assert.equal(
      (await read(runtime, checkout.id, "right.txt")).content,
      "RIGHT\n",
    );
    assert.equal(
      (await read(runtime, checkout.id, "shared.txt")).content,
      "ONE\ntwo\nthree\nFOUR\n",
    );
    assert.equal(
      (await run(runtime, checkout.id, ["diff", "--cached"])).stdout,
      "",
    );

    const conflictPreview =
      await runtime.components.application.workspaces.previewWorktreeApply(
        conflicting.id,
      );
    assert.equal(conflictPreview.pendingFiles, 2);
    assert.equal(conflictPreview.mergeableFiles, 1);
    assert.equal(conflictPreview.conflictFiles, 1);
    assert.equal(conflictPreview.canApply, true);
    assert.equal(conflictPreview.reason, null);
    assert.equal(
      conflictPreview.files.find((file) => file.path === "shared.txt")
        ?.conflict,
      true,
    );
    const partial =
      await runtime.components.application.workspaces.applyWorktree(
        conflicting.id,
      );
    assert.deepEqual(partial.conflicts, ["shared.txt"]);
    assert.deepEqual(partial.paths, ["extra.txt"]);
    assert.equal(
      (await read(runtime, checkout.id, "extra.txt")).content,
      "extra\n",
    );
    const remainingConflict =
      await runtime.components.application.workspaces.previewWorktreeApply(
        conflicting.id,
      );
    assert.equal(remainingConflict.pendingFiles, 1);
    assert.equal(remainingConflict.mergeableFiles, 0);
    assert.equal(remainingConflict.conflictFiles, 1);
    assert.equal(remainingConflict.canApply, false);
    assert.equal(remainingConflict.reason, "merge-conflicts");
    await assert.rejects(
      runtime.components.application.workspaces.applyWorktree(conflicting.id, [
        "shared.txt",
      ]),
      (error: unknown) => {
        assert.equal((error as { code?: string }).code, "CONFLICT");
        assert.match((error as Error).message, /merge conflicts/);
        return true;
      },
    );
    const sourceAfterConflict = (await read(runtime, checkout.id, "shared.txt"))
      .content;
    assert.equal(sourceAfterConflict, "ONE\ntwo\nthree\nFOUR\n");
    assert.doesNotMatch(sourceAfterConflict, /<<<<<<<|=======|>>>>>>>/);
  } finally {
    await runtime.cleanup();
  }
});
