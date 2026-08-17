import type { OperationLog } from "../../operations/operation-log.js";
import type { InternalPlugin } from "../types.js";
import { createServiceToken } from "../types.js";
import { PipeProcessBackend } from "./infrastructure/pipe-process-backend.js";
import { PtyProcessBackend } from "./infrastructure/pty-process-backend.js";
import { registerProcessTools } from "./mcp.js";
import { ProcessSupervisor } from "./process-supervisor.js";

export const ProcessService = createServiceToken<ProcessSupervisor>("process");

export function createProcessPlugin(): InternalPlugin {
  let service: ProcessSupervisor | null = null;
  let operations: OperationLog | null = null;

  return {
    id: "process",
    activate(context) {
      service = new ProcessSupervisor(
        { pipe: new PipeProcessBackend(), pty: new PtyProcessBackend() },
        context.operations,
        context.events,
        context.config.process.maxOutputBytes,
        context.config.process.defaultTimeoutMs,
        context.config.process.maxCompletedProcesses,
      );
      operations = context.operations;
      context.services.provide(ProcessService, service);
    },
    registerMcp(server) {
      if (!service || !operations)
        throw new Error("Process plugin is not active");
      registerProcessTools(server, service, operations);
    },
    async deactivate() {
      await service?.shutdown();
      service = null;
      operations = null;
    },
  };
}
