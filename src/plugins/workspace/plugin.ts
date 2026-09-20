import type { InternalPlugin } from "#plugins/types";
import { createServiceToken } from "#plugins/types";
import { registerWorkspaceTools } from "./mcp.js";
import { WorkspaceService } from "./workspace-service.js";

export const WorkspaceServiceToken =
  createServiceToken<WorkspaceService>("workspace");

export function createWorkspacePlugin(): InternalPlugin {
  let service: WorkspaceService | null = null;
  return {
    id: "workspace",
    async activate(context) {
      service = await WorkspaceService.create(context.config.allowedRoots);
      context.services.provide(WorkspaceServiceToken, service);
    },
    registerMcp(mcp) {
      if (!service) throw new Error("Workspace plugin is not active");
      registerWorkspaceTools(mcp, service);
    },
    deactivate() {
      service = null;
    },
  };
}
