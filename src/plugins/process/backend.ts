export interface BackendProcess {
  readonly pid: number | null;
  write(data: string): void;
  kill(signal?: NodeJS.Signals): void;
  onStdout(listener: (chunk: Buffer) => void): void;
  onStderr(listener: (chunk: Buffer) => void): void;
  onExit(
    listener: (exit: {
      exitCode: number | null;
      signal: string | null;
    }) => void,
  ): void;
}

export interface ProcessBackend {
  readonly kind: "pipe" | "pty";
  start(
    command: string,
    args: string[],
    options: { cwd: string; env: NodeJS.ProcessEnv },
  ): Promise<BackendProcess>;
}
