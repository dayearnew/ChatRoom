import { CommandRunner } from "#core/runtime/command-runner";
import type { InternalPlugin } from "#plugins/types";
import { createServiceToken } from "#plugins/types";
import { GitService } from "./git-service.js";

export const GitServiceToken = createServiceToken<GitService>("git");

export function createGitPlugin(): InternalPlugin {
  return {
    id: "git",
    activate(context) {
      context.services.provide(
        GitServiceToken,
        new GitService(new CommandRunner()),
      );
    },
  };
}
