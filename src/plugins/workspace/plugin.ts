import type { OperationLog } from "../../operations/operation-log.js";
import { CommandRunner } from "../../core/runtime/command-runner.js";
import type { InternalPlugin } from "../types.js";
import { createServiceToken } from "../types.js";
import { GitCommandRunner } from "./git/git-command-runner.js";
import { GitService } from "./git/git-service.js";
import { GitSnapshotService } from "./git/git-snapshot-service.js";
import { WorkspaceRepository } from "./infrastructure/workspace-repository.js";
import { registerWorkspaceTools } from "./mcp.js";
import { WorkspaceService as WorkspaceRuntime } from "./workspace-service.js";
import { WorktreeReviewService } from "./worktree-review-service.js";

interface WorkspacePluginService {
  workspaces: WorkspaceRuntime;
  git: GitService;
}

export const WorkspaceService =
  createServiceToken<WorkspacePluginService>("workspace");

export function createWorkspacePlugin(): InternalPlugin {
  let value: WorkspacePluginService | null = null;
  let operations: OperationLog | null = null;

  return {
    id: "workspace",
    async activate(context) {
      const gitRunner = new GitCommandRunner(new CommandRunner());
      const git = new GitService(gitRunner);
      const snapshots = new GitSnapshotService(gitRunner, git);
      const review = new WorktreeReviewService(git, snapshots);
      const workspaces = await WorkspaceRuntime.create(
        new WorkspaceRepository(context.database),
        git,
        review,
        context.config.allowedRoots,
        context.config.dataDir,
      );
      await workspaces.discoverGitWorkspaces();
      value = { workspaces, git };
      operations = context.operations;
      context.services.provide(WorkspaceService, value);
    },
    registerMcp(server) {
      if (!value || !operations)
        throw new Error("Workspace plugin is not active");
      registerWorkspaceTools(server, value.workspaces, operations);
    },
    deactivate() {
      value = null;
      operations = null;
    },
  };
}
