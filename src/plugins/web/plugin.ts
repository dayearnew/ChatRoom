import type { InternalPlugin } from "#plugins/types";
import { createServiceToken } from "#plugins/types";
import { ComputerServiceToken } from "#plugins/computer/plugin";
import { GitServiceToken } from "#plugins/git/plugin";
import { ProcessService } from "#plugins/process/plugin";
import { WorkspaceServiceToken } from "#plugins/workspace/plugin";
import { WebRuntime } from "./runtime.js";

interface WebPluginService {
  application: WebRuntime;
}
export const WebServiceToken = createServiceToken<WebPluginService>("web");

export function createWebPlugin(): InternalPlugin {
  return {
    id: "web",
    activate(context) {
      context.services.provide(WebServiceToken, {
        application: new WebRuntime(
          context.services.require(WorkspaceServiceToken),
          context.services.require(GitServiceToken),
          context.operations,
          context.services.require(ProcessService),
          context.services.require(ComputerServiceToken),
          context.mcpTools,
        ),
      });
    },
  };
}
