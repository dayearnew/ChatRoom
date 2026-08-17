/** Pipe-based ProcessBackend implemented with Node child_process.spawn. */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type { BackendProcess, ProcessBackend } from "../backend.js";

export class PipeProcessBackend implements ProcessBackend {
  readonly kind = "pipe" as const;

  async start(
    command: string,
    args: string[],
    options: { cwd: string; env: NodeJS.ProcessEnv },
  ): Promise<BackendProcess> {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["pipe", "pipe", "pipe"],
      detached: process.platform !== "win32",
      windowsHide: true,
    });
    await new Promise<void>((resolve, reject) => {
      child.once("spawn", resolve);
      child.once("error", reject);
    });
    return new PipeBackendProcess(child);
  }
}

class PipeBackendProcess implements BackendProcess {
  constructor(private readonly child: ChildProcessWithoutNullStreams) {}
  get pid(): number | null {
    return this.child.pid ?? null;
  }
  write(data: string): void {
    this.child.stdin.write(data);
  }
  kill(signal: NodeJS.Signals = "SIGTERM"): void {
    if (!this.child.pid) return;
    if (process.platform === "win32") {
      const args = ["/PID", String(this.child.pid), "/T"];
      if (signal === "SIGKILL") args.push("/F");
      const killer = spawn("taskkill.exe", args, {
        stdio: "ignore",
        windowsHide: true,
      });
      killer.once("error", () => this.child.kill(signal));
      return;
    }
    try {
      process.kill(-this.child.pid, signal);
    } catch {
      this.child.kill(signal);
    }
  }
  onStdout(listener: (chunk: Buffer) => void): void {
    this.child.stdout.on("data", listener);
  }
  onStderr(listener: (chunk: Buffer) => void): void {
    this.child.stderr.on("data", listener);
  }
  onExit(
    listener: (exit: {
      exitCode: number | null;
      signal: string | null;
    }) => void,
  ): void {
    this.child.once("close", (code, signal) =>
      listener({ exitCode: code, signal }),
    );
  }
}
