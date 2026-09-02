import { CommandRunner } from "../../core/runtime/command-runner.js";
import type { InternalPlugin } from "../types.js";
import { createServiceToken } from "../types.js";
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
