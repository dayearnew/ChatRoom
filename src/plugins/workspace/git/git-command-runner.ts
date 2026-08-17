import type { CommandRunner } from "../../../core/runtime/command-runner.js";

export class GitCommandRunner {
  constructor(private readonly commands: CommandRunner) {}

  run(cwd: string, args: string[], env?: Record<string, string>) {
    return this.commands.run({
      cwd,
      command: "git",
      args,
      timeoutMs: 120_000,
      env: { LC_ALL: "C", LANG: "C", ...(env ?? {}) },
    });
  }
}
