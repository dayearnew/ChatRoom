import type { InternalPlugin } from "../types.js";
import { createServiceToken } from "../types.js";
import { PipeProcessBackend } from "./infrastructure/pipe-process-backend.js";
import { PtyProcessBackend } from "./infrastructure/pty-process-backend.js";
import { registerProcessTools } from "./mcp.js";
import { ProcessSupervisor } from "./process-supervisor.js";

export const ProcessService = createServiceToken<ProcessSupervisor>("process");

export function createProcessPlugin(): InternalPlugin {
  let service: ProcessSupervisor | null = null;

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
      context.services.provide(ProcessService, service);
    },
    registerMcp(mcp) {
      if (!service) throw new Error("Process plugin is not active");
      registerProcessTools(mcp, service);
    },
    async deactivate() {
      await service?.shutdown();
      service = null;
    },
  };
}
