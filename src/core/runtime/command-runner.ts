import { spawn } from "node:child_process";
import { ChatRoomError } from "../errors/chatroom-error.js";
import { childEnvironment } from "./child-environment.js";

export interface CommandRequest {
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
}

export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export class CommandRunner {
  run(request: CommandRequest): Promise<CommandResult> {
    return new Promise((resolve, reject) => {
      const child = spawn(request.command, request.args ?? [], {
        cwd: request.cwd,
        env: childEnvironment(request.env),
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      const timeout = request.timeoutMs
        ? setTimeout(() => child.kill("SIGKILL"), request.timeoutMs)
        : null;
      timeout?.unref();
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        stdout += chunk;
      });
      child.stderr.on("data", (chunk: string) => {
        stderr += chunk;
      });
      child.once("error", reject);
      child.once("close", (code) => {
        if (timeout) clearTimeout(timeout);
        const exitCode = code ?? -1;
        if (exitCode !== 0) {
          reject(
            new ChatRoomError(
              "PROCESS_FAILED",
              `${request.command} exited with code ${exitCode}`,
              { stdout, stderr, exitCode },
            ),
          );
          return;
        }
        resolve({ stdout, stderr, exitCode });
      });
    });
  }
}
