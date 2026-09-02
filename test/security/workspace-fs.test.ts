import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ChatRoomError } from "../../src/core/errors/chatroom-error.js";
import { WorkspaceFs } from "../../src/plugins/workspace/workspace-fs.js";

function forbidden(operation: () => Promise<unknown>): Promise<void> {
  return assert.rejects(
    operation,
    (error: unknown) =>
      error instanceof ChatRoomError && error.code === "FORBIDDEN",
  );
}

test("WorkspaceFs rejects traversal, absolute paths, and symlink escape", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "chatroom-fs-"));
  const workspace = path.join(root, "workspace");
  const outside = path.join(root, "outside");
  try {
    await mkdir(workspace);
    await mkdir(outside);
    await writeFile(path.join(outside, "secret.txt"), "outside-secret");
    await symlink(
      path.join(outside, "secret.txt"),
      path.join(workspace, "secret-link"),
    );
    const fs = await WorkspaceFs.create(workspace);

    await forbidden(() => fs.read("../outside/secret.txt"));
    await forbidden(() => fs.read(path.join(workspace, "file.txt")));
    await forbidden(() => fs.read("C:\\Windows\\system.ini"));
    await forbidden(() => fs.read("secret-link"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
