import type { OperationLog } from "../../operations/operation-log.js";
import type { ComputerService } from "../computer/computer-service.js";
import type { GitService } from "../git/git-service.js";
import type { ProcessSupervisor } from "../process/process-supervisor.js";
import type { WorkspaceService } from "../workspace/workspace-service.js";

export class WebRuntime {
  constructor(
    readonly workspaces: WorkspaceService,
    readonly git: GitService,
    readonly operations: OperationLog,
    readonly processes: ProcessSupervisor,
    readonly computer: ComputerService,
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
    return this.processes.list();
  }

  getProcess(processId: string) {
    return this.processes.read(processId);
  }
}
