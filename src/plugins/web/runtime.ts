import type { OperationLog } from "../../operations/operation-log.js";
import type { WorkspaceService } from "../workspace/workspace-service.js";
import type { ProcessSupervisor } from "../process/process-supervisor.js";
import type { GitService } from "../workspace/git/git-service.js";
import type { ComputerService } from "../computer/computer-service.js";

export class WebRuntime {
  constructor(
    readonly workspaces: WorkspaceService,
    readonly operations: OperationLog,
    readonly processes: ProcessSupervisor,
    readonly git: GitService,
    readonly computer: ComputerService,
  ) {}

  previewWorktreeApply(workspaceId: string) {
    return this.workspaces.previewWorktreeApply(workspaceId);
  }

  previewWorktreeFileDiff(workspaceId: string, filePath: string) {
    return this.workspaces.previewWorktreeFileDiff(workspaceId, filePath);
  }

  applyWorktree(workspaceId: string, paths?: string[]) {
    return this.operations.run(
      {
        pluginId: "workspace",
        source: "gui",
        action: "worktree.apply",
        workspaceId,
        input: { workspaceId, paths: paths ?? null },
      },
      () => this.workspaces.applyWorktree(workspaceId, paths),
    );
  }

  processKill(processId: string, force = false) {
    return this.operations.run(
      {
        pluginId: "process",
        source: "gui",
        action: force ? "kill" : "terminate",
        processId,
        input: { processId, force },
      },
      async () => this.processes.kill(processId, force),
    );
  }

  listProcesses() {
    return this.processes.list();
  }

  getProcess(processId: string) {
    return this.processes.read(processId);
  }

  discoverWorkspaces() {
    return this.workspaces.discoverGitWorkspaces();
  }

  getWorkspace(workspaceId: string) {
    return this.workspaces.get(workspaceId);
  }

  async readWorkspaceFile(
    workspaceId: string,
    filePath: string,
    maxBytes?: number,
  ) {
    const fs = await this.workspaces.fs(workspaceId);
    return fs.read(filePath, {
      ...(maxBytes === undefined ? {} : { maxBytes }),
    });
  }

  async readWorkspaceFileBytes(
    workspaceId: string,
    filePath: string,
    maxBytes: number,
  ) {
    const fs = await this.workspaces.fs(workspaceId);
    return fs.readBytes(filePath, { maxBytes });
  }

  async listWorkspaceFiles(
    workspaceId: string,
    filePath = ".",
    recursive = false,
  ) {
    const fs = await this.workspaces.fs(workspaceId);
    return fs.list(filePath, { recursive });
  }

  gitInfoQuery(workspaceId: string) {
    const workspace = this.workspaces.markUsed(workspaceId);
    return this.git.info(workspace.root);
  }
}
