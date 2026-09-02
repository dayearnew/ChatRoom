import { ChatRoomError } from "../../../core/errors/chatroom-error.js";
import type { BackendProcess, ProcessBackend } from "../backend.js";

interface PtyModule {
  spawn(
    file: string,
    args: string[],
    options: {
      name: string;
      cols: number;
      rows: number;
      cwd: string;
      env: Record<string, string>;
    },
  ): {
    pid: number;
    write(data: string): void;
    kill(signal?: string): void;
    onData(listener: (data: string) => void): { dispose(): void };
    onExit(listener: (event: { exitCode: number; signal?: number }) => void): {
      dispose(): void;
    };
  };
}

export class PtyProcessBackend implements ProcessBackend {
  readonly kind = "pty" as const;
  async start(
    command: string,
    args: string[],
    options: { cwd: string; env: NodeJS.ProcessEnv },
  ): Promise<BackendProcess> {
    let pty: PtyModule;
    try {
      pty = (await import("node-pty")) as unknown as PtyModule;
    } catch (error) {
      throw new ChatRoomError(
        "UNSUPPORTED",
        "PTY support is unavailable; install optional dependency node-pty",
        undefined,
        { cause: error },
      );
    }
    const env = Object.fromEntries(
      Object.entries(options.env).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    );
    const processHandle = pty.spawn(command, args, {
      name: env.TERM ?? "xterm-256color",
      cols: 120,
      rows: 30,
      cwd: options.cwd,
      env,
    });
    return new PtyBackendProcess(processHandle);
  }
}

class PtyBackendProcess implements BackendProcess {
  constructor(private readonly processHandle: ReturnType<PtyModule["spawn"]>) {}
  get pid(): number {
    return this.processHandle.pid;
  }
  write(data: string): void {
    this.processHandle.write(data);
  }
  kill(signal: NodeJS.Signals = "SIGTERM"): void {
    this.processHandle.kill(signal);
  }
  onStdout(listener: (chunk: Buffer) => void): void {
    this.processHandle.onData((data) => listener(Buffer.from(data)));
  }
  onStderr(_listener: (chunk: Buffer) => void): void {}
  onExit(
    listener: (exit: {
      exitCode: number | null;
      signal: string | null;
    }) => void,
  ): void {
    this.processHandle.onExit((event) =>
      listener({
        exitCode: event.exitCode,
        signal: event.signal ? String(event.signal) : null,
      }),
    );
  }
}
