import type { InternalPlugin } from "../types.js";
import { createServiceToken } from "../types.js";
import { ComputerServiceToken } from "../computer/plugin.js";
import { GitServiceToken } from "../git/plugin.js";
import { ProcessService } from "../process/plugin.js";
import { WorkspaceServiceToken } from "../workspace/plugin.js";
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
        ),
      });
    },
  };
}
