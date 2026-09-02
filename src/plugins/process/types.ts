type ProcessState = "running" | "exited" | "killed" | "failed";
export type ProcessId = string;

export interface ProcessStartRequest {
  cwd: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  pty?: boolean;
  timeoutMs?: number;
}

export interface ProcessSnapshot {
  processId: ProcessId;
  command: string;
  args: string[];
  cwd: string;
  pid: number | null;
  state: ProcessState;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number;
  exitCode: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  outputTruncated: boolean;
  timedOut: boolean;
  operationId: string;
}
