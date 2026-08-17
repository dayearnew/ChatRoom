import { ChatRoomError } from "../../core/errors/chatroom-error.js";
import type { WorktreeApplyPreview } from "./domain/review.js";
import type { Workspace } from "./domain/workspace.js";
import type { GitService } from "./git/git-service.js";
import type { GitSnapshotService } from "./git/git-snapshot-service.js";

export class WorktreeReviewService {
  constructor(
    private readonly git: GitService,
    private readonly snapshots: GitSnapshotService,
  ) {}

  async preview(workspace: Workspace): Promise<WorktreeApplyPreview> {
    requireWorktree(workspace);
    const [state, worktreeInfo, sourceInfo] = await Promise.all([
      this.snapshots.applyState(workspace.root, workspace.sourceRoot),
      this.git.info(workspace.root),
      this.git.info(workspace.sourceRoot),
    ]);
    const pendingFiles = state.files.filter((file) => !file.applied).length;
    const conflictFiles = state.files.filter(
      (file) => !file.applied && file.conflict,
    ).length;
    const mergeableFiles = pendingFiles - conflictFiles;
    let reason: WorktreeApplyPreview["reason"] = null;
    if (!state.files.length || pendingFiles === 0) reason = "no-changes";
    else if (
      !worktreeInfo.head ||
      !sourceInfo.head ||
      worktreeInfo.head !== sourceInfo.head
    )
      reason = "head-mismatch";
    else if (mergeableFiles === 0 && conflictFiles > 0)
      reason = "merge-conflicts";
    return {
      files: state.files,
      totalFiles: state.files.length,
      pendingFiles,
      appliedFiles: state.files.length - pendingFiles,
      mergeableFiles,
      conflictFiles,
      canApply: reason === null && mergeableFiles > 0,
      reason,
    };
  }

  fileDiff(workspace: Workspace, filePath: string) {
    requireWorktree(workspace);
    return this.snapshots.fileDiff(workspace.root, filePath);
  }

  apply(workspace: Workspace, paths?: string[]) {
    requireWorktree(workspace);
    return this.snapshots.apply(workspace.root, workspace.sourceRoot, paths);
  }
}

function requireWorktree(workspace: Workspace): void {
  if (workspace.mode !== "worktree")
    throw new ChatRoomError(
      "INVALID_INPUT",
      "Workspace is not a managed worktree",
    );
}
