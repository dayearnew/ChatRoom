import type { InternalPlugin } from "../types.js";
import { createServiceToken } from "../types.js";
import { NativeComputerBackend } from "./computer-native-backend.js";
import { ComputerService } from "./computer-service.js";
import { ComputerSettingsRepository } from "./computer-settings-repository.js";
import { registerComputerTools } from "./mcp.js";
import { currentMcpAccessScope } from "../../mcp/server/request-context.js";

export const ComputerServiceToken =
  createServiceToken<ComputerService>("computer");

export function createComputerPlugin(): InternalPlugin {
  let service: ComputerService | null = null;
  return {
    id: "computer",
    activate(context) {
      service = new ComputerService(
        new NativeComputerBackend(),
        new ComputerSettingsRepository(context.database),
        context.events,
      );
      context.services.provide(ComputerServiceToken, service);
    },
    registerMcp(mcp) {
      if (!service) throw new Error("Computer plugin is not active");
      if (
        currentMcpAccessScope() === "remote" &&
        !service.settings().remoteAccess
      )
        return;
      registerComputerTools(mcp, service);
    },
    async deactivate() {
      await service?.shutdown();
      service = null;
    },
  };
}
