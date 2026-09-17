import { mkdtemp, open, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ChatRoomError } from "../../core/errors/chatroom-error.js";
import type { CommandRunner } from "../../core/runtime/command-runner.js";
import type {
  GitBranch,
  GitChange,
  GitChangeKind,
  GitCommit,
  GitDiff,
  GitStatus,
} from "./types.js";

const MAX_PATHS = 512;

export class GitService {
  constructor(private readonly commands: CommandRunner) {}

  async status(cwd: string): Promise<GitStatus | null> {
    const root = await this.repositoryRoot(cwd);
    if (!root) return null;
    const result = await this.run(root, [
      "status",
      "--porcelain=v2",
      "--branch",
      "-z",
      "--untracked-files=all",
    ]);
    return parseStatus(result.stdout);
  }

  async diff(
    cwd: string,
    filePath?: string,
    maxPreviewBytes = 2 * 1024 * 1024,
  ): Promise<GitDiff> {
    const root = await this.requireRepository(cwd);
    await this.requireHead(root);
    const paths = filePath ? await this.relatedPaths(root, [filePath]) : [];
    return this.withSnapshotIndex(root, async ({ env, tempDir }) => {
      const patchPath = path.join(tempDir, "changes.patch");
      await this.run(
        root,
        [
          "diff",
          "--cached",
          "--binary",
          "--no-ext-diff",
          "--no-renames",
          `--output=${patchPath}`,
          "HEAD",
          ...(paths.length ? ["--", ...paths] : []),
        ],
        env,
      );
      return readPatch(patchPath, maxPreviewBytes);
    });
  }

  async stage(cwd: string, paths: string[]): Promise<GitStatus> {
    const root = await this.requireRepository(cwd);
    await this.run(root, [
      "add",
      "-A",
      "--",
      ...(await this.relatedPaths(root, paths)),
    ]);
    return this.requireStatus(root);
  }

  async unstage(cwd: string, paths: string[]): Promise<GitStatus> {
    const root = await this.requireRepository(cwd);
    const expanded = await this.relatedPaths(root, paths);
    if (await this.head(root))
      await this.run(root, ["restore", "--staged", "--", ...expanded]);
    else await this.run(root, ["rm", "--cached", "-r", "--", ...expanded]);
    return this.requireStatus(root);
  }

  async restore(cwd: string, filePath: string): Promise<GitStatus> {
    const root = await this.requireRepository(cwd);
    const requested = normalizePath(filePath);
    const status = await this.requireStatus(root);
    const change = status.changes.find(
      (item) => item.path === requested || item.originalPath === requested,
    );
    if (!change)
      throw new ChatRoomError(
        "NOT_FOUND",
        `No Git change found for path: ${requested}`,
      );

    if (change.kind === "untracked") {
      await this.run(root, ["clean", "-f", "--", change.path]);
      return this.requireStatus(root);
    }

    await this.requireHead(root);
    const paths = [
      change.path,
      ...(change.originalPath ? [change.originalPath] : []),
    ];
    const tracked: string[] = [];
    const untracked: string[] = [];
    for (const file of [...new Set(paths)]) {
      if (await this.pathExistsInHead(root, file)) tracked.push(file);
      else untracked.push(file);
    }
    if (tracked.length)
      await this.run(root, [
        "restore",
        "--source=HEAD",
        "--staged",
        "-W",
        "--",
        ...tracked,
      ]);
    if (untracked.length) {
      await this.run(root, ["restore", "--staged", "--", ...untracked]).catch(
        () => undefined,
      );
      await this.run(root, ["clean", "-f", "--", ...untracked]);
    }
    return this.requireStatus(root);
  }

  async commit(cwd: string, message: string): Promise<GitStatus> {
    const root = await this.requireRepository(cwd);
    const normalized = message.trim();
    if (!normalized)
      throw new ChatRoomError("INVALID_INPUT", "Commit message is required");
    if (normalized.length > 10_000)
      throw new ChatRoomError("INVALID_INPUT", "Commit message is too long");
    await this.run(root, ["commit", "-m", normalized]);
    return this.requireStatus(root);
  }

  async branches(cwd: string): Promise<GitBranch[]> {
    const root = await this.requireRepository(cwd);
    const result = await this.run(root, [
      "for-each-ref",
      "--format=%(HEAD)%00%(refname:short)%00%(upstream:short)",
      "refs/heads",
    ]);
    return result.stdout
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        const [head = "", name = "", upstream = ""] = line.split("\0");
        return {
          name,
          current: head.trim() === "*",
          upstream: upstream || null,
        };
      })
      .filter((branch) => Boolean(branch.name));
  }

  async createBranch(cwd: string, name: string): Promise<GitStatus> {
    const root = await this.requireRepository(cwd);
    const branch = await this.validateBranchName(root, name);
    await this.run(root, ["switch", "-c", branch]);
    return this.requireStatus(root);
  }

  async switchBranch(cwd: string, name: string): Promise<GitStatus> {
    const root = await this.requireRepository(cwd);
    const branch = await this.validateBranchName(root, name);
    await this.run(root, ["switch", branch]);
    return this.requireStatus(root);
  }

  async deleteBranch(cwd: string, name: string): Promise<GitStatus> {
    const root = await this.requireRepository(cwd);
    const branch = await this.validateBranchName(root, name);
    await this.run(root, ["branch", "-d", branch]);
    return this.requireStatus(root);
  }

  async log(cwd: string, limit = 30): Promise<GitCommit[]> {
    const root = await this.requireRepository(cwd);
    if (!(await this.head(root))) return [];
    const count = Math.min(Math.max(Math.trunc(limit), 1), 100);
    const result = await this.run(root, [
      "log",
      `-n${count}`,
      "--pretty=format:%H%x1f%h%x1f%an%x1f%aI%x1f%s%x1e",
    ]);
    return result.stdout
      .split("\x1e")
      .map((record) => record.trim())
      .filter(Boolean)
      .map((record) => {
        const [
          hash = "",
          shortHash = "",
          author = "",
          date = "",
          subject = "",
        ] = record.split("\x1f");
        return { hash, shortHash, author, date, subject };
      });
  }

  async fetch(cwd: string): Promise<GitStatus> {
    const root = await this.requireRepository(cwd);
    await this.run(root, ["fetch", "--all", "--prune"]);
    return this.requireStatus(root);
  }

  async pull(cwd: string): Promise<GitStatus> {
    const root = await this.requireRepository(cwd);
    await this.run(root, ["pull", "--ff-only"]);
    return this.requireStatus(root);
  }

  async push(cwd: string): Promise<GitStatus> {
    const root = await this.requireRepository(cwd);
    await this.run(root, ["push"]);
    return this.requireStatus(root);
  }

  private run(cwd: string, args: string[], env?: Record<string, string>) {
    return this.commands.run({
      cwd,
      command: "git",
      args,
      timeoutMs: 120_000,
      env: { LC_ALL: "C", LANG: "C", ...(env ?? {}) },
    });
  }

  private async repositoryRoot(cwd: string): Promise<string | null> {
    try {
      const root = path.resolve(
        (await this.run(cwd, ["rev-parse", "--show-toplevel"])).stdout.trim(),
      );
      return root === path.resolve(cwd) ? root : null;
    } catch (error) {
      if (isNotRepositoryError(error)) return null;
      throw error;
    }
  }

  private async requireRepository(cwd: string): Promise<string> {
    const root = await this.repositoryRoot(cwd);
    if (!root)
      throw new ChatRoomError(
        "INVALID_INPUT",
        "Workspace is not a Git repository",
      );
    return root;
  }

  private async requireStatus(cwd: string): Promise<GitStatus> {
    const status = await this.status(cwd);
    if (!status)
      throw new ChatRoomError(
        "INVALID_INPUT",
        "Workspace is not a Git repository",
      );
    return status;
  }

  private async head(cwd: string): Promise<string | null> {
    try {
      return (
        (
          await this.run(cwd, ["rev-parse", "--verify", "HEAD"])
        ).stdout.trim() || null
      );
    } catch (error) {
      if (isMissingHeadError(error)) return null;
      throw error;
    }
  }

  private async requireHead(cwd: string): Promise<string> {
    const head = await this.head(cwd);
    if (!head)
      throw new ChatRoomError(
        "CONFLICT",
        "Git operation requires at least one commit",
      );
    return head;
  }

  private async relatedPaths(cwd: string, paths: string[]): Promise<string[]> {
    const normalized = normalizePaths(paths);
    const status = await this.requireStatus(cwd);
    const output = new Set(normalized);
    for (const requested of normalized) {
      const change = status.changes.find(
        (item) => item.path === requested || item.originalPath === requested,
      );
      if (change?.path) output.add(change.path);
      if (change?.originalPath) output.add(change.originalPath);
    }
    return [...output];
  }

  private async pathExistsInHead(
    cwd: string,
    filePath: string,
  ): Promise<boolean> {
    try {
      await this.run(cwd, ["cat-file", "-e", `HEAD:${filePath}`]);
      return true;
    } catch {
      return false;
    }
  }

  private async validateBranchName(cwd: string, name: string): Promise<string> {
    const normalized = name.trim();
    if (!normalized)
      throw new ChatRoomError("INVALID_INPUT", "Branch name is required");
    await this.run(cwd, ["check-ref-format", "--branch", normalized]);
    return normalized;
  }

  private async withSnapshotIndex<T>(
    cwd: string,
    useIndex: (context: {
      env: Record<string, string>;
      tempDir: string;
    }) => Promise<T>,
  ): Promise<T> {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "chatroom-git-"));
    const env = { GIT_INDEX_FILE: path.join(tempDir, "index") };
    try {
      await this.run(cwd, ["read-tree", "HEAD"], env);
      await this.run(cwd, ["add", "-A", "--", "."], env);
      return await useIndex({ env, tempDir });
    } finally {
      await rm(tempDir, { recursive: true, force: true }).catch(
        () => undefined,
      );
    }
  }
}

function parseStatus(output: string): GitStatus {
  let branch: string | null = null;
  let head: string | null = null;
  let upstream: string | null = null;
  let ahead = 0;
  let behind = 0;
  const changes: GitChange[] = [];
  const records = output.split("\0");

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (!record) continue;
    if (record.startsWith("# branch.oid ")) {
      const value = record.slice("# branch.oid ".length);
      head = value === "(initial)" ? null : value || null;
      continue;
    }
    if (record.startsWith("# branch.head ")) {
      const value = record.slice("# branch.head ".length);
      branch = value === "(detached)" ? null : value || null;
      continue;
    }
    if (record.startsWith("# branch.upstream ")) {
      upstream = record.slice("# branch.upstream ".length) || null;
      continue;
    }
    if (record.startsWith("# branch.ab ")) {
      const match = /^\+(\d+) -(\d+)$/.exec(
        record.slice("# branch.ab ".length),
      );
      if (match) {
        ahead = Number(match[1]);
        behind = Number(match[2]);
      }
      continue;
    }

    const type = record[0];
    if (type === "?") {
      changes.push({
        path: record.slice(2),
        originalPath: null,
        indexStatus: "?",
        workingTreeStatus: "?",
        kind: "untracked",
      });
      continue;
    }
    if (type === "!") continue;

    const fields = record.split(" ");
    if (type === "1" && fields.length >= 9) {
      pushTrackedChange(changes, fields[1]!, fields.slice(8).join(" "), null);
      continue;
    }
    if (type === "2" && fields.length >= 10) {
      const originalPath = records[++index] || null;
      pushTrackedChange(
        changes,
        fields[1]!,
        fields.slice(9).join(" "),
        originalPath,
      );
      continue;
    }
    if (type === "u" && fields.length >= 11) {
      pushTrackedChange(changes, fields[1]!, fields.slice(10).join(" "), null);
    }
  }

  return {
    branch,
    head,
    upstream,
    ahead,
    behind,
    changes: changes.sort((a, b) => a.path.localeCompare(b.path)),
  };
}

function pushTrackedChange(
  changes: GitChange[],
  xy: string,
  filePath: string,
  originalPath: string | null,
): void {
  const indexStatus = normalizePorcelainStatus(xy[0]);
  const workingTreeStatus = normalizePorcelainStatus(xy[1]);
  changes.push({
    path: filePath,
    originalPath,
    indexStatus,
    workingTreeStatus,
    kind: changeKind(indexStatus, workingTreeStatus),
  });
}

function normalizePorcelainStatus(value: string | undefined): string {
  return !value || value === "." ? " " : value;
}

function changeKind(
  indexStatus: string,
  workingTreeStatus: string,
): GitChangeKind {
  const pair = `${indexStatus}${workingTreeStatus}`;
  if (pair === "??") return "untracked";
  if (
    ["DD", "AU", "UD", "UA", "DU", "AA", "UU"].includes(pair) ||
    indexStatus === "U" ||
    workingTreeStatus === "U"
  )
    return "conflicted";
  if (pair.includes("R")) return "renamed";
  if (pair.includes("C")) return "copied";
  if (pair.includes("A")) return "added";
  if (pair.includes("D")) return "deleted";
  return "modified";
}

function normalizePaths(paths: string[]): string[] {
  if (!Array.isArray(paths) || paths.length < 1)
    throw new ChatRoomError(
      "INVALID_INPUT",
      "At least one file path is required",
    );
  if (paths.length > MAX_PATHS)
    throw new ChatRoomError("INVALID_INPUT", "Too many file paths");
  return [...new Set(paths.map(normalizePath))];
}

function normalizePath(input: string): string {
  if (typeof input !== "string" || !input || input.includes("\0"))
    throw new ChatRoomError("INVALID_INPUT", "File path is required");
  if (
    path.isAbsolute(input) ||
    path.win32.isAbsolute(input) ||
    /^\\\\/.test(input)
  )
    throw new ChatRoomError("FORBIDDEN", "Absolute Git paths are not allowed");
  const parts = input
    .split(/[\\/]+/)
    .filter((part) => part !== "" && part !== ".");
  if (parts.length === 0 || parts.some((part) => part === ".."))
    throw new ChatRoomError("FORBIDDEN", "Invalid Git path");
  return parts.join("/");
}

async function readPatch(
  patchPath: string,
  maxBytes: number,
): Promise<GitDiff> {
  const size = (await stat(patchPath)).size;
  const previewBytes = Math.min(size, maxBytes);
  const handle = await open(patchPath, "r");
  try {
    const buffer = Buffer.alloc(previewBytes);
    const { bytesRead } = await handle.read(buffer, 0, previewBytes, 0);
    return {
      diff: buffer.subarray(0, bytesRead).toString("utf8"),
      truncated: size > previewBytes,
    };
  } finally {
    await handle.close();
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
    text.includes("ambiguous argument 'head'") ||
    text.includes("not a valid object name head")
  );
}
