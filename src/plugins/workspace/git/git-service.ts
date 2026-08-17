import path from "node:path";
import { ChatRoomError } from "../../../core/errors/chatroom-error.js";
import type { GitInfo } from "../domain/git.js";
import type { GitCommandRunner } from "./git-command-runner.js";

export class GitService {
  constructor(private readonly runner: GitCommandRunner) {}

  async info(cwd: string): Promise<GitInfo> {
    try {
      const root = (
        await this.runner.run(cwd, ["rev-parse", "--show-toplevel"])
      ).stdout.trim();
      const [head, branch, status] = await Promise.all([
        this.head(cwd),
        this.branch(cwd),
        this.runner.run(cwd, ["status", "--porcelain"]),
      ]);
      return {
        isRepository: true,
        branch,
        head,
        dirty: status.stdout.trim().length > 0,
        root: path.resolve(root),
      };
    } catch (error) {
      if (isNotRepositoryError(error))
        return {
          isRepository: false,
          branch: null,
          head: null,
          dirty: false,
          root: null,
        };
      throw error;
    }
  }

  async head(cwd: string): Promise<string | null> {
    try {
      return (
        (
          await this.runner.run(cwd, ["rev-parse", "--verify", "HEAD"])
        ).stdout.trim() || null
      );
    } catch (error) {
      if (isMissingHeadError(error)) return null;
      throw error;
    }
  }

  async branch(cwd: string): Promise<string | null> {
    const value = (
      await this.runner.run(cwd, ["branch", "--show-current"])
    ).stdout.trim();
    return value || null;
  }

  async status(cwd: string): Promise<string> {
    return (await this.runner.run(cwd, ["status", "--short", "--branch"]))
      .stdout;
  }

  async diff(cwd: string): Promise<string> {
    const [unstaged, staged] = await Promise.all([
      this.runner.run(cwd, ["diff", "--no-ext-diff", "--unified=3"]),
      this.runner.run(cwd, [
        "diff",
        "--cached",
        "--no-ext-diff",
        "--unified=3",
      ]),
    ]);
    return [unstaged.stdout, staged.stdout].filter(Boolean).join("\n");
  }

  async createWorktree(sourceRoot: string, target: string): Promise<void> {
    const info = await this.info(sourceRoot);
    if (!info.isRepository)
      throw new ChatRoomError(
        "INVALID_INPUT",
        "Worktree mode requires a Git repository",
      );
    if (!info.head)
      throw new ChatRoomError(
        "CONFLICT",
        "Worktree mode requires at least one Git commit; repository HEAD does not exist",
      );
    await this.runner.run(sourceRoot, [
      "worktree",
      "add",
      "--detach",
      target,
      "HEAD",
    ]);
  }

  async removeWorktree(
    sourceRoot: string,
    target: string,
    force = false,
  ): Promise<void> {
    await this.runner.run(sourceRoot, [
      "worktree",
      "remove",
      ...(force ? ["--force"] : []),
      target,
    ]);
  }

  async pruneWorktrees(sourceRoot: string): Promise<void> {
    await this.runner.run(sourceRoot, ["worktree", "prune"]);
  }
}

function gitErrorText(error: unknown): string {
  if (!(error instanceof ChatRoomError)) return "";
  const details = error.details as
    { stdout?: unknown; stderr?: unknown } | undefined;
  return `${String(details?.stdout ?? "")}\n${String(details?.stderr ?? "")}`.toLowerCase();
}

function isNotRepositoryError(error: unknown): boolean {
  return gitErrorText(error).includes("not a git repository");
}

function isMissingHeadError(error: unknown): boolean {
  const text = gitErrorText(error);
  return (
    text.includes("needed a single revision") ||
    text.includes("unknown revision") ||
    text.includes("bad revision") ||
    text.includes("ambiguous argument 'head'")
  );
}
