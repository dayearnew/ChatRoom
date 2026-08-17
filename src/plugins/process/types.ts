/**
 * Process lifecycle and request types shared above the platform-specific backend layer.
 * ProcessId is independent from the OS PID and transport/session identity.
 */
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
  /** Bounded retained output rather than an unbounded transcript. */
  stdout: string;
  stderr: string;
  outputTruncated: boolean;
  timedOut: boolean;
  operationId: string;
}
