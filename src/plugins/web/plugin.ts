import type { InternalPlugin } from "../types.js";
import { createServiceToken } from "../types.js";
import { WorkspaceService } from "../workspace/plugin.js";
import { ProcessService } from "../process/plugin.js";
import { WebRuntime } from "./runtime.js";

interface WebPluginService {
  application: WebRuntime;
}
export const WebServiceToken = createServiceToken<WebPluginService>("web");

export function createWebPlugin(): InternalPlugin {
  return {
    id: "web",
    activate(context) {
      const workspace = context.services.require(WorkspaceService);
      const processes = context.services.require(ProcessService);
      context.services.provide(WebServiceToken, {
        application: new WebRuntime(
          workspace.workspaces,
          context.operations,
          processes,
          workspace.git,
        ),
      });
    },
  };
}
