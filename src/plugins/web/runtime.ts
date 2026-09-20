import type { OperationLog } from "#operations/operation-log";
import type { ComputerService } from "#plugins/computer/computer-service";
import type { GitService } from "#plugins/git/git-service";
import type { ProcessSupervisor } from "#plugins/process/process-supervisor";
import type { WorkspaceService } from "#plugins/workspace/workspace-service";
import type { McpToolControl } from "#mcp/server/tool-control";

export class WebRuntime {
  constructor(
    readonly workspaces: WorkspaceService,
    readonly git: GitService,
    readonly operations: OperationLog,
    readonly processes: ProcessSupervisor,
    readonly computer: ComputerService,
    readonly mcpTools: McpToolControl,
  ) {}

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
    return this.processes.summaries();
  }

  getProcess(processId: string) {
    return this.processes.read(processId);
  }
}
