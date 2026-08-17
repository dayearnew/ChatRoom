/**
 * Owns persistent Workspace identity, allowed-root validation, checkout/worktree creation, and workspace capabilities.
 * Workspace lifetime is deliberately independent from MCP or HTTP connection lifetime.
 */
import { existsSync, realpathSync } from "node:fs";
import { mkdir, readdir, realpath, rm } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { ChatRoomError } from "../../core/errors/chatroom-error.js";
import type { Workspace, WorkspaceMode } from "./domain/workspace.js";
import type {
  WorkspaceRecord,
  WorkspaceStateRepository,
} from "./domain/repository.js";
import { WorkspaceFs } from "./infrastructure/workspace-fs.js";
import type { GitService } from "./git/git-service.js";
import type { WorktreeReviewService } from "./worktree-review-service.js";
import {
  discoverInstructions,
  discoverSkills,
  exists,
  expandHome,
  inside,
  toRecord,
} from "./workspace-helpers.js";

interface OpenWorkspaceRequest {
  path: string;
  mode?: WorkspaceMode;
}

export class WorkspaceService {
  private readonly pending = new Map<string, Promise<Workspace>>();
  private readonly filesystems = new Map<string, WorkspaceFs>();
  private readonly workspaces = new Map<string, Workspace>();

  private constructor(
    private readonly repository: WorkspaceStateRepository,
    private readonly git: GitService,
    private readonly review: WorktreeReviewService,
    private readonly allowedRoots: string[],
    private readonly dataDir: string,
  ) {}

  static async create(
    repository: WorkspaceStateRepository,
    git: GitService,
    review: WorktreeReviewService,
    allowedRoots: string[],
    dataDir: string,
  ): Promise<WorkspaceService> {
    // Canonicalize allowed roots once at startup so later comparisons use stable real paths.
    const canonicalRoots: string[] = [];
    for (const root of allowedRoots) {
      const expanded = expandHome(root);
      const canonical = await realpath(expanded).catch(() => {
        throw new ChatRoomError(
          "NOT_FOUND",
          `Allowed root does not exist: ${root}`,
        );
      });
      canonicalRoots.push(canonical);
    }
    await mkdir(path.join(dataDir, "worktrees"), {
      recursive: true,
      mode: 0o700,
    });
    const service = new WorkspaceService(
      repository,
      git,
      review,
      canonicalRoots,
      dataDir,
    );
    await service.restorePersistedWorkspaces();
    await service.reconcileManagedWorktrees();
    return service;
  }

  async open(request: OpenWorkspaceRequest): Promise<Workspace> {
    const mode = request.mode ?? "checkout";
    const sourceRoot = await this.validateSourceRoot(request.path);
    if (mode === "worktree") return this.openLocked(sourceRoot, mode);
    const key = `checkout:${sourceRoot}`;
    // Coalesce concurrent opens of the same logical workspace instead of racing worktree creation or persistence.
    const existingPending = this.pending.get(key);
    if (existingPending) return existingPending;
    const operation = this.openLocked(sourceRoot, mode).finally(() =>
      this.pending.delete(key),
    );
    this.pending.set(key, operation);
    return operation;
  }

  get(workspaceId: string): Workspace {
    const workspace = this.workspaces.get(workspaceId);
    if (!workspace)
      throw new ChatRoomError(
        "NOT_FOUND",
        `Unknown WorkspaceId: ${workspaceId}`,
      );
    if (!this.isRecordValid(workspace)) {
      this.filesystems.delete(workspace.id);
      this.workspaces.delete(workspace.id);
      this.repository.remove(workspace.id);
      throw new ChatRoomError(
        "NOT_FOUND",
        `Workspace no longer exists: ${workspaceId}`,
      );
    }
    return workspace;
  }

  list(): Workspace[] {
    const valid: Workspace[] = [];
    for (const workspace of this.workspaces.values()) {
      if (this.isRecordValid(workspace)) {
        valid.push(workspace);
        continue;
      }
      this.filesystems.delete(workspace.id);
      this.workspaces.delete(workspace.id);
      this.repository.remove(workspace.id);
    }
    return valid.sort((a, b) => b.lastUsedAt.localeCompare(a.lastUsedAt));
  }

  async discoverGitWorkspaces(): Promise<Workspace[]> {
    for (const root of this.allowedRoots) {
      await this.discoverGitWorkspace(root);
      let entries;
      try {
        entries = await readdir(root, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
        await this.discoverGitWorkspace(path.join(root, entry.name));
      }
    }
    return this.list();
  }

  private async discoverGitWorkspace(candidate: string): Promise<void> {
    if (!(await exists(path.join(candidate, ".git")))) return;
    const existing = [...this.workspaces.values()].find(
      (workspace) =>
        workspace.root === candidate && workspace.mode === "checkout",
    );
    if (existing && this.isRecordValid(existing)) return;
    if (existing) {
      this.workspaces.delete(existing.id);
      this.repository.remove(existing.id);
    }
    await this.createWorkspace(candidate, candidate, "checkout");
  }

  markUsed(workspaceId: string): Workspace {
    const workspace = this.get(workspaceId);
    workspace.lastUsedAt = new Date().toISOString();
    this.repository.upsert(toRecord(workspace));
    return workspace;
  }

  async fs(workspaceId: string): Promise<WorkspaceFs> {
    const workspace = this.markUsed(workspaceId);
    const existing = this.filesystems.get(workspaceId);
    if (existing) return existing;
    const filesystem = await WorkspaceFs.create(workspace.root);
    this.filesystems.set(workspaceId, filesystem);
    return filesystem;
  }

  async refresh(workspaceId: string): Promise<Workspace> {
    const workspace = this.get(workspaceId);
    const fs = await this.fs(workspaceId);
    const gitInfo = await this.git.info(workspace.root);
    workspace.instructions = await discoverInstructions(fs);
    workspace.skills = await discoverSkills(fs);
    workspace.capabilities = {
      filesystem: "read-write",
      git: gitInfo.isRepository,
      skills: workspace.skills.length > 0,
    };
    return workspace;
  }

  async remove(workspaceId: string, force = false): Promise<Workspace> {
    const workspace = this.get(workspaceId);
    if (workspace.mode === "checkout") {
      this.filesystems.delete(workspace.id);
      this.workspaces.delete(workspace.id);
      this.repository.remove(workspace.id);
      return workspace;
    }

    const gitInfo = await this.git.info(workspace.root);
    if (gitInfo.dirty && !force)
      throw new ChatRoomError(
        "CONFLICT",
        "Worktree contains uncommitted changes",
      );

    await this.git.removeWorktree(workspace.sourceRoot, workspace.root, force);
    await this.git.pruneWorktrees(workspace.sourceRoot).catch(() => undefined);
    this.filesystems.delete(workspace.id);
    this.workspaces.delete(workspace.id);
    this.repository.remove(workspace.id);
    await this.removeManagedContainer(workspace.root);
    return workspace;
  }

  async previewWorktreeApply(workspaceId: string) {
    return this.review.preview(this.get(workspaceId));
  }

  async previewWorktreeFileDiff(workspaceId: string, filePath: string) {
    return this.review.fileDiff(this.get(workspaceId), filePath);
  }

  async applyWorktree(
    workspaceId: string,
    paths?: string[],
  ): Promise<{
    workspaceId: string;
    bytes: number;
    paths: string[];
    conflicts: string[];
  }> {
    const workspace = this.get(workspaceId);
    const result = await this.review.apply(workspace, paths);
    this.markUsed(workspace.id);
    return { workspaceId: workspace.id, ...result };
  }

  private async openLocked(
    sourceRoot: string,
    mode: WorkspaceMode,
  ): Promise<Workspace> {
    if (mode === "checkout") {
      const existing = [...this.workspaces.values()].find(
        (workspace) =>
          workspace.root === sourceRoot && workspace.mode === "checkout",
      );
      if (existing) {
        this.filesystems.set(
          existing.id,
          await WorkspaceFs.create(existing.root),
        );
        return this.refresh(existing.id);
      }
      return this.createWorkspace(sourceRoot, sourceRoot, mode);
    }

    const uuid = randomUUID();
    const id = `ws_${uuid}`;
    const container = path.join(
      this.dataDir,
      "worktrees",
      uuid.replaceAll("-", "").slice(0, 8),
    );
    const target = path.join(
      container,
      path.basename(sourceRoot) || "workspace",
    );
    await mkdir(container, { recursive: true, mode: 0o700 });
    let worktreeCreated = false;
    try {
      await this.git.createWorktree(sourceRoot, target);
      worktreeCreated = true;
      return await this.createWorkspace(target, sourceRoot, mode, id);
    } catch (error) {
      this.filesystems.delete(id);
      this.workspaces.delete(id);
      this.repository.remove(id);
      if (worktreeCreated)
        await this.git
          .removeWorktree(sourceRoot, target, true)
          .catch(() => undefined);
      await this.git.pruneWorktrees(sourceRoot).catch(() => undefined);
      await rm(container, { recursive: true, force: true }).catch(
        () => undefined,
      );
      throw error;
    }
  }

  private async createWorkspace(
    root: string,
    sourceRoot: string,
    mode: WorkspaceMode,
    id = `ws_${randomUUID()}`,
  ): Promise<Workspace> {
    const fs = await WorkspaceFs.create(root);
    this.filesystems.set(id, fs);
    const gitInfo = await this.git.info(root);
    const now = new Date().toISOString();
    const skills = await discoverSkills(fs);
    const workspace: Workspace = {
      id,
      root,
      sourceRoot,
      mode,
      createdAt: now,
      lastUsedAt: now,
      instructions: await discoverInstructions(fs),
      skills,
      capabilities: {
        filesystem: "read-write",
        git: gitInfo.isRepository,
        skills: skills.length > 0,
      },
    };
    this.workspaces.set(workspace.id, workspace);
    this.repository.upsert(toRecord(workspace));
    return workspace;
  }

  private async restorePersistedWorkspaces(): Promise<void> {
    for (const record of this.repository.list()) {
      if (!this.isRecordValid(record)) {
        this.repository.remove(record.id);
        if (record.mode === "worktree")
          await this.removeManagedContainer(record.root);
        continue;
      }
      try {
        const fs = await WorkspaceFs.create(record.root);
        const gitInfo = await this.git.info(record.root);
        const skills = await discoverSkills(fs);
        const workspace: Workspace = {
          ...record,
          instructions: await discoverInstructions(fs),
          skills,
          capabilities: {
            filesystem: "read-write",
            git: gitInfo.isRepository,
            skills: skills.length > 0,
          },
        };
        this.filesystems.set(record.id, fs);
        this.workspaces.set(record.id, workspace);
      } catch {
        this.repository.remove(record.id);
        if (record.mode === "worktree")
          await this.removeManagedContainer(record.root);
      }
    }
  }

  private isRecordValid(record: WorkspaceRecord): boolean {
    if (!existsSync(record.root) || !existsSync(record.sourceRoot))
      return false;
    try {
      const sourceRoot = realpathSync(record.sourceRoot);
      if (!this.allowedRoots.some((root) => inside(root, sourceRoot)))
        return false;
      if (record.mode === "checkout")
        return realpathSync(record.root) === sourceRoot;
      const managedRoot = realpathSync(path.join(this.dataDir, "worktrees"));
      return inside(managedRoot, realpathSync(record.root));
    } catch {
      return false;
    }
  }

  private async reconcileManagedWorktrees(): Promise<void> {
    const pruned = new Set<string>();
    for (const workspace of [...this.workspaces.values()]) {
      if (workspace.mode !== "worktree") continue;
      if (await exists(workspace.sourceRoot)) {
        if (!pruned.has(workspace.sourceRoot)) {
          await this.git
            .pruneWorktrees(workspace.sourceRoot)
            .catch(() => undefined);
          pruned.add(workspace.sourceRoot);
        }
      }
      if (await exists(workspace.root)) continue;
      this.filesystems.delete(workspace.id);
      this.workspaces.delete(workspace.id);
      this.repository.remove(workspace.id);
      await this.removeManagedContainer(workspace.root);
    }

    const managedRoot = path.join(this.dataDir, "worktrees");
    const knownContainers = new Set(
      [...this.workspaces.values()]
        .filter((workspace) => workspace.mode === "worktree")
        .map((workspace) => path.resolve(path.dirname(workspace.root))),
    );
    for (const entry of await readdir(managedRoot, { withFileTypes: true })) {
      const container = path.resolve(managedRoot, entry.name);
      if (knownContainers.has(container)) continue;
      if (entry.isSymbolicLink()) {
        await rm(container, { force: true }).catch(() => undefined);
        continue;
      }
      if (entry.isDirectory())
        await rm(container, { recursive: true, force: true });
    }
  }

  private async removeManagedContainer(worktreeRoot: string): Promise<void> {
    const managedRoot = path.join(this.dataDir, "worktrees");
    if (!inside(managedRoot, worktreeRoot)) return;
    const container = path.dirname(worktreeRoot);
    if (container === managedRoot) return;
    await rm(container, { recursive: true, force: true }).catch(
      () => undefined,
    );
  }

  private async validateSourceRoot(input: string): Promise<string> {
    if (!input || typeof input !== "string")
      throw new ChatRoomError("INVALID_INPUT", "Workspace path is required");
    const canonical = await realpath(expandHome(input)).catch(() => {
      throw new ChatRoomError(
        "NOT_FOUND",
        `Workspace path does not exist: ${input}`,
      );
    });
    if (!this.allowedRoots.some((root) => inside(root, canonical))) {
      throw new ChatRoomError(
        "FORBIDDEN",
        "Workspace is outside configured allowedRoots",
        {
          path: canonical,
        },
      );
    }
    return canonical;
  }
}
