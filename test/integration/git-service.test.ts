import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile, appendFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import {
  CommandRunner,
  type CommandRequest,
} from "../../src/core/runtime/command-runner.js";
import { GitService } from "../../src/plugins/git/git-service.js";

const execFileAsync = promisify(execFile);

async function git(cwd: string, ...args: string[]): Promise<void> {
  await execFileAsync("git", args, { cwd });
}

test("GitService status uses porcelain v2 and preserves change semantics", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "chatroom-git-"));
  try {
    await git(dir, "init", "-b", "main");
    await git(dir, "config", "user.email", "chatroom@example.com");
    await git(dir, "config", "user.name", "ChatRoom Test");
    await writeFile(path.join(dir, "tracked.txt"), "one\n");
    await git(dir, "add", "tracked.txt");
    await git(dir, "commit", "-m", "initial");
    const remote = path.join(dir, "remote.git");
    await execFileAsync("git", ["init", "--bare", remote]);
    await git(dir, "remote", "add", "origin", remote);
    await git(dir, "push", "-u", "origin", "main");
    await writeFile(path.join(dir, "ahead.txt"), "ahead\n");
    await git(dir, "add", "ahead.txt");
    await git(dir, "commit", "-m", "ahead");
    await git(dir, "mv", "tracked.txt", "renamed file.txt");
    await appendFile(path.join(dir, "renamed file.txt"), "two\n");
    await writeFile(path.join(dir, "untracked file.txt"), "new\n");

    const delegate = new CommandRunner();
    let calls = 0;
    const commands: CommandRunner = {
      run(request: CommandRequest) {
        calls += 1;
        return delegate.run(request);
      },
    };
    const service = new GitService(commands);
    const status = await service.status(dir);

    assert.ok(status);
    assert.equal(
      calls,
      2,
      "status should require only repo-root and status commands",
    );
    assert.equal(status.branch, "main");
    assert.match(status.head ?? "", /^[0-9a-f]{40}$/);
    assert.equal(status.upstream, "origin/main");
    assert.equal(status.ahead, 1);
    assert.equal(status.behind, 0);
    assert.deepEqual(
      status.changes.find((item) => item.path === "renamed file.txt"),
      {
        path: "renamed file.txt",
        originalPath: "tracked.txt",
        indexStatus: "R",
        workingTreeStatus: "M",
        kind: "renamed",
      },
    );
    assert.deepEqual(
      status.changes.find((item) => item.path === "untracked file.txt"),
      {
        path: "untracked file.txt",
        originalPath: null,
        indexStatus: "?",
        workingTreeStatus: "?",
        kind: "untracked",
      },
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
