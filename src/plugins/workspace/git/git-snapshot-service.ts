import { mkdtemp, open, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ChatRoomError } from "../../../core/errors/chatroom-error.js";
import type { WorktreeFileDiff, WorktreeReviewFile } from "../domain/review.js";
import type { GitCommandRunner } from "./git-command-runner.js";
import type { GitService } from "./git-service.js";

interface SnapshotStateFile extends WorktreeReviewFile {
  target: string;
}

interface SnapshotState {
  files: SnapshotStateFile[];
  byPath: Map<string, SnapshotStateFile>;
}

interface Snapshot {
  tree: string;
  state: SnapshotState;
}

interface MergeAnalysis {
  mergedTree: string;
  conflicts: Set<string>;
  deltaPaths: Set<string>;
}

interface WorktreeMergeFile extends WorktreeReviewFile {
  applied: boolean;
  conflict: boolean;
}

export class GitSnapshotService {
  constructor(
    private readonly runner: GitCommandRunner,
    private readonly git: GitService,
  ) {}

  async fileDiff(
    cwd: string,
    filePath: string,
    maxPreviewBytes = 2 * 1024 * 1024,
  ): Promise<WorktreeFileDiff> {
    return this.withIndex(cwd, async ({ env, tempDir }) => {
      await this.stageAll(cwd, env);
      const state = await this.stateFromIndex(cwd, env);
      if (!state.byPath.has(filePath))
        throw new ChatRoomError("NOT_FOUND", "Worktree file change not found");
      const patchPath = path.join(tempDir, "file.patch");
      await this.writeHeadPatch(cwd, env, patchPath, [filePath]);
      return {
        path: filePath,
        ...(await readPatchPreview(patchPath, maxPreviewBytes)),
      };
    });
  }

  async apply(
    worktreeRoot: string,
    sourceRoot: string,
    requestedPaths?: string[],
  ): Promise<{ bytes: number; paths: string[]; conflicts: string[] }> {
    const [worktreeHead, sourceHead, worktree, source] = await Promise.all([
      this.git.head(worktreeRoot),
      this.git.head(sourceRoot),
      this.snapshot(worktreeRoot),
      this.snapshot(sourceRoot),
    ]);
    if (!worktreeHead || !sourceHead || worktreeHead !== sourceHead)
      throw new ChatRoomError(
        "CONFLICT",
        "Source checkout HEAD no longer matches the worktree HEAD",
      );
    if (!worktree.state.files.length)
      throw new ChatRoomError("CONFLICT", "Worktree has no changes to apply");

    const baseTree = await this.baseTree(worktreeRoot, worktreeHead);
    const fullAnalysis = await this.analyze(
      worktreeRoot,
      baseTree,
      source.tree,
      worktree.tree,
      worktree.state.files.map((file) => file.path),
    );
    const reviewed = reviewFiles(worktree.state, source.state, fullAnalysis);
    const pending = reviewed.filter((file) => !file.applied);
    const selected = resolveRequestedPaths(pending, requestedPaths);
    const selectedConflicts = selected
      .filter((file) => file.conflict)
      .map((file) => file.path);
    if (requestedPaths !== undefined && selectedConflicts.length)
      throw new ChatRoomError(
        "CONFLICT",
        "Selected worktree files have merge conflicts",
        {
          paths: selectedConflicts,
        },
      );

    const paths = selected
      .filter((file) => !file.conflict)
      .map((file) => file.path);
    if (!paths.length)
      throw new ChatRoomError(
        "CONFLICT",
        "No selected worktree files can be merged automatically",
        {
          paths: selectedConflicts,
        },
      );

    const selectedTree = await this.treeForPaths(worktreeRoot, paths);
    const merge = await this.analyze(
      worktreeRoot,
      baseTree,
      source.tree,
      selectedTree,
      paths,
    );
    if (merge.conflicts.size)
      throw new ChatRoomError(
        "CONFLICT",
        "Selected worktree files have merge conflicts",
        {
          paths: [...merge.conflicts],
        },
      );

    return this.withIndex(worktreeRoot, async ({ tempDir }) => {
      const patchPath = path.join(tempDir, "merge.patch");
      await this.writeTreePatch(
        sourceRoot,
        patchPath,
        source.tree,
        merge.mergedTree,
        paths,
      );
      const bytes = (await stat(patchPath)).size;
      if (bytes === 0)
        throw new ChatRoomError(
          "CONFLICT",
          "Selected worktree files are already integrated",
        );

      const [
        currentWorktreeHead,
        currentSourceHead,
        currentSource,
        currentSelectedTree,
      ] = await Promise.all([
        this.git.head(worktreeRoot),
        this.git.head(sourceRoot),
        this.snapshot(sourceRoot),
        this.treeForPaths(worktreeRoot, paths),
      ]);
      if (
        currentWorktreeHead !== worktreeHead ||
        currentSourceHead !== sourceHead ||
        currentSource.tree !== source.tree ||
        currentSelectedTree !== selectedTree
      )
        throw new ChatRoomError(
          "CONFLICT",
          "Workspace changed while preparing worktree merge",
        );

      await this.runner.run(sourceRoot, [
        "apply",
        "--check",
        "--binary",
        patchPath,
      ]);
      await this.runner.run(sourceRoot, ["apply", "--binary", patchPath]);
      return { bytes, paths, conflicts: selectedConflicts };
    });
  }

  async applyState(
    worktreeRoot: string,
    sourceRoot: string,
  ): Promise<{ files: WorktreeMergeFile[] }> {
    const [worktreeHead, sourceHead, worktree, source] = await Promise.all([
      this.git.head(worktreeRoot),
      this.git.head(sourceRoot),
      this.snapshot(worktreeRoot),
      this.snapshot(sourceRoot),
    ]);
    if (!worktreeHead || !sourceHead || worktreeHead !== sourceHead) {
      return {
        files: worktree.state.files.map(({ target, ...file }) => ({
          ...file,
          applied: source.state.byPath.get(file.path)?.target === target,
          conflict: false,
        })),
      };
    }
    const baseTree = await this.baseTree(worktreeRoot, worktreeHead);
    const analysis = await this.analyze(
      worktreeRoot,
      baseTree,
      source.tree,
      worktree.tree,
      worktree.state.files.map((file) => file.path),
    );
    return { files: reviewFiles(worktree.state, source.state, analysis) };
  }

  private async analyze(
    cwd: string,
    baseTree: string,
    oursTree: string,
    theirsTree: string,
    paths: string[],
  ): Promise<MergeAnalysis> {
    const merge = await this.mergeTrees(cwd, baseTree, oursTree, theirsTree);
    const delta = await this.runner.run(cwd, [
      "diff",
      "--name-only",
      "-z",
      "--no-renames",
      oursTree,
      merge.mergedTree,
      "--",
      ...paths,
    ]);
    return {
      ...merge,
      deltaPaths: new Set(delta.stdout.split("\0").filter(Boolean)),
    };
  }

  private async mergeTrees(
    cwd: string,
    baseTree: string,
    oursTree: string,
    theirsTree: string,
  ): Promise<{ mergedTree: string; conflicts: Set<string> }> {
    const args = [
      "merge-tree",
      "--write-tree",
      `--merge-base=${baseTree}`,
      "--messages",
      "--name-only",
      "-z",
      oursTree,
      theirsTree,
    ];
    let stdout: string;
    try {
      stdout = (await this.runner.run(cwd, args)).stdout;
    } catch (error) {
      const details =
        error instanceof ChatRoomError
          ? (error.details as
              { stdout?: unknown; exitCode?: unknown } | undefined)
          : undefined;
      if (
        error instanceof ChatRoomError &&
        error.code === "PROCESS_FAILED" &&
        details?.exitCode === 1
      )
        stdout = String(details.stdout ?? "");
      else throw error;
    }
    const tokens = stdout.split("\0");
    const mergedTree = tokens[0]?.trim() ?? "";
    if (!/^[0-9a-f]{40,64}$/.test(mergedTree))
      throw new ChatRoomError(
        "INTERNAL",
        "Git merge-tree did not return a merged tree",
      );
    const conflicts = new Set<string>();
    for (
      let index = 1;
      index < tokens.length && tokens[index] !== "";
      index++
    ) {
      if (tokens[index]) conflicts.add(tokens[index]!);
    }
    return { mergedTree, conflicts };
  }

  private async snapshot(cwd: string): Promise<Snapshot> {
    return this.withIndex(cwd, async ({ env }) => {
      await this.stageAll(cwd, env);
      const [state, tree] = await Promise.all([
        this.stateFromIndex(cwd, env),
        this.writeTree(cwd, env),
      ]);
      return { state, tree };
    });
  }

  private async treeForPaths(cwd: string, paths: string[]): Promise<string> {
    return this.withIndex(cwd, async ({ env }) => {
      await this.runner.run(cwd, ["add", "-A", "--", ...paths], env);
      return this.writeTree(cwd, env);
    });
  }

  private async baseTree(cwd: string, head: string): Promise<string> {
    return (
      await this.runner.run(cwd, ["rev-parse", `${head}^{tree}`])
    ).stdout.trim();
  }

  private async writeTree(
    cwd: string,
    env: Record<string, string>,
  ): Promise<string> {
    return (await this.runner.run(cwd, ["write-tree"], env)).stdout.trim();
  }

  private async stageAll(
    cwd: string,
    env: Record<string, string>,
  ): Promise<void> {
    await this.runner.run(cwd, ["add", "-A", "--", "."], env);
  }

  private async stateFromIndex(
    cwd: string,
    env: Record<string, string>,
  ): Promise<SnapshotState> {
    const [raw, numstat] = await Promise.all([
      this.runner.run(
        cwd,
        [
          "diff",
          "--cached",
          "--raw",
          "-z",
          "--no-renames",
          "--abbrev=40",
          "HEAD",
        ],
        env,
      ),
      this.runner.run(
        cwd,
        ["diff", "--cached", "--numstat", "-z", "--no-renames", "HEAD"],
        env,
      ),
    ]);
    const stats = parseNumstat(numstat.stdout);
    const tokens = raw.stdout.split("\0");
    const files: SnapshotStateFile[] = [];
    for (let index = 0; index + 1 < tokens.length; index += 2) {
      const header = tokens[index];
      const filePath = tokens[index + 1];
      if (!header || !filePath) continue;
      const match =
        /^:(\d{6}) (\d{6}) ([0-9a-f]{40}) ([0-9a-f]{40}) ([AMDT])$/.exec(
          header,
        );
      if (!match)
        throw new ChatRoomError(
          "INTERNAL",
          `Unexpected Git raw diff entry: ${header}`,
        );
      const statEntry = stats.get(filePath) ?? {
        additions: null,
        deletions: null,
        binary: true,
      };
      files.push({
        path: filePath,
        status: rawStatus(match[5]!),
        additions: statEntry.additions,
        deletions: statEntry.deletions,
        binary: statEntry.binary,
        target: `${match[2]!}:${match[4]!}`,
      });
    }
    return { files, byPath: new Map(files.map((file) => [file.path, file])) };
  }

  private async writeHeadPatch(
    cwd: string,
    env: Record<string, string>,
    patchPath: string,
    paths: string[],
  ): Promise<void> {
    await this.runner.run(
      cwd,
      [
        "diff",
        "--cached",
        "--binary",
        "--no-ext-diff",
        "--no-renames",
        `--output=${patchPath}`,
        "HEAD",
        "--",
        ...paths,
      ],
      env,
    );
  }

  private async writeTreePatch(
    cwd: string,
    patchPath: string,
    fromTree: string,
    toTree: string,
    paths: string[],
  ): Promise<void> {
    await this.runner.run(cwd, [
      "diff",
      "--binary",
      "--no-ext-diff",
      "--no-renames",
      `--output=${patchPath}`,
      fromTree,
      toTree,
      "--",
      ...paths,
    ]);
  }

  private async withIndex<T>(
    cwd: string,
    useIndex: (context: {
      env: Record<string, string>;
      tempDir: string;
    }) => Promise<T>,
  ): Promise<T> {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "chatroom-worktree-"));
    const env = { GIT_INDEX_FILE: path.join(tempDir, "index") };
    try {
      await this.runner.run(cwd, ["read-tree", "HEAD"], env);
      return await useIndex({ env, tempDir });
    } finally {
      await rm(tempDir, { recursive: true, force: true }).catch(
        () => undefined,
      );
    }
  }
}

function reviewFiles(
  worktree: SnapshotState,
  source: SnapshotState,
  analysis: MergeAnalysis,
): WorktreeMergeFile[] {
  const mappedConflicts = mapConflictPaths(worktree.files, analysis.conflicts);
  return worktree.files.map(({ target, ...file }) => {
    const conflict = mappedConflicts.has(file.path);
    const exact = source.byPath.get(file.path)?.target === target;
    const integrated = !conflict && !analysis.deltaPaths.has(file.path);
    return { ...file, applied: exact || integrated, conflict };
  });
}

function mapConflictPaths(
  files: SnapshotStateFile[],
  conflicts: Set<string>,
): Set<string> {
  const mapped = new Set<string>();
  for (const file of files) {
    for (const conflict of conflicts) {
      if (
        conflict === file.path ||
        conflict.startsWith(`${file.path}/`) ||
        file.path.startsWith(`${conflict}/`)
      ) {
        mapped.add(file.path);
        break;
      }
    }
  }
  if (conflicts.size && !mapped.size)
    for (const file of files) mapped.add(file.path);
  return mapped;
}

function resolveRequestedPaths(
  pending: WorktreeMergeFile[],
  requestedPaths?: string[],
): WorktreeMergeFile[] {
  if (requestedPaths === undefined) return pending;
  const requested = [...new Set(requestedPaths)];
  if (!requested.length)
    throw new ChatRoomError(
      "INVALID_INPUT",
      "At least one file path is required",
    );
  const byPath = new Map(pending.map((file) => [file.path, file]));
  return requested.map((filePath) => {
    const file = byPath.get(filePath);
    if (!file)
      throw new ChatRoomError(
        "CONFLICT",
        `Worktree file is already applied or unavailable: ${filePath}`,
      );
    return file;
  });
}

function rawStatus(value: string): WorktreeReviewFile["status"] {
  if (value === "A") return "added";
  if (value === "D") return "deleted";
  if (value === "T") return "type-changed";
  return "modified";
}

function parseNumstat(
  value: string,
): Map<
  string,
  { additions: number | null; deletions: number | null; binary: boolean }
> {
  const result = new Map<
    string,
    { additions: number | null; deletions: number | null; binary: boolean }
  >();
  for (const entry of value.split("\0")) {
    if (!entry) continue;
    const first = entry.indexOf("\t");
    const second = first < 0 ? -1 : entry.indexOf("\t", first + 1);
    if (first < 0 || second < 0) continue;
    const additionsText = entry.slice(0, first);
    const deletionsText = entry.slice(first + 1, second);
    const filePath = entry.slice(second + 1);
    const binary = additionsText === "-" || deletionsText === "-";
    result.set(filePath, {
      additions: binary ? null : Number(additionsText),
      deletions: binary ? null : Number(deletionsText),
      binary,
    });
  }
  return result;
}

async function readPatchPreview(
  patchPath: string,
  maxPreviewBytes: number,
): Promise<{ diff: string; bytes: number; truncated: boolean }> {
  const size = (await stat(patchPath)).size;
  const previewBytes = Math.min(size, maxPreviewBytes);
  const handle = await open(patchPath, "r");
  try {
    const buffer = Buffer.alloc(previewBytes);
    const { bytesRead } = await handle.read(buffer, 0, previewBytes, 0);
    return {
      diff: buffer.subarray(0, bytesRead).toString("utf8"),
      bytes: size,
      truncated: size > previewBytes,
    };
  } finally {
    await handle.close();
  }
}
