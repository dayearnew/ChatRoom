/** Core filesystem boundary coverage for traversal, symlink escape, and transactional patches. */
import assert from "node:assert/strict";
import test from "node:test";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { WorkspaceFs } from "../../src/plugins/workspace/infrastructure/workspace-fs.js";
import { ChatRoomError } from "../../src/core/errors/chatroom-error.js";

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "chatroom-fs-"));
  const workspace = path.join(root, "workspace");
  const outside = path.join(root, "outside");
  await mkdir(workspace);
  await mkdir(outside);
  await writeFile(path.join(outside, "secret.txt"), "outside-secret");
  return { root, workspace, outside, fs: await WorkspaceFs.create(workspace) };
}

async function forbidden(operation: () => Promise<unknown>): Promise<void> {
  await assert.rejects(
    operation,
    (error: unknown) =>
      error instanceof ChatRoomError && error.code === "FORBIDDEN",
  );
}

test("rejects traversal and absolute paths on reads and writes", async () => {
  const item = await fixture();
  try {
    await forbidden(() => item.fs.read("../outside/secret.txt"));
    await forbidden(() => item.fs.write("../outside/created.txt", "bad"));
    await forbidden(() => item.fs.read(path.join(item.workspace, "file.txt")));
    await forbidden(() => item.fs.write("C:\\Windows\\system.ini", "bad"));
  } finally {
    await rm(item.root, { recursive: true, force: true });
  }
});

test("rejects symlink escape for read and write", async () => {
  const item = await fixture();
  try {
    await symlink(
      path.join(item.outside, "secret.txt"),
      path.join(item.workspace, "read-link"),
    );
    await symlink(item.outside, path.join(item.workspace, "write-link"));
    await forbidden(() => item.fs.read("read-link"));
    await forbidden(() => item.fs.write("write-link/escaped.txt", "bad"));
    await assert.rejects(
      readFile(path.join(item.outside, "escaped.txt")),
      /ENOENT/,
    );
  } finally {
    await rm(item.root, { recursive: true, force: true });
  }
});

test("multi-file patch validates every replacement before writing anything", async () => {
  const item = await fixture();
  try {
    await writeFile(path.join(item.workspace, "a.txt"), "alpha");
    await writeFile(path.join(item.workspace, "b.txt"), "beta");
    await assert.rejects(
      item.fs.patch([
        { path: "a.txt", oldText: "alpha", newText: "changed" },
        { path: "b.txt", oldText: "missing", newText: "changed" },
      ]),
      (error: unknown) =>
        error instanceof ChatRoomError && error.code === "CONFLICT",
    );
    assert.equal(
      await readFile(path.join(item.workspace, "a.txt"), "utf8"),
      "alpha",
    );
    assert.equal(
      await readFile(path.join(item.workspace, "b.txt"), "utf8"),
      "beta",
    );
  } finally {
    await rm(item.root, { recursive: true, force: true });
  }
});
