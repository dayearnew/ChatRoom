/** Persistent plugin operation lifecycle recorded by ChatRoom. */
export const OPERATION_STATUSES = [
  "running",
  "success",
  "error",
  "cancelled",
] as const;
export type OperationStatus = (typeof OPERATION_STATUSES)[number];

/** Where an operation was initiated; pluginId identifies which plugin owns the operation. */
export const OPERATION_SOURCES = ["mcp", "gui", "system", "cli"] as const;
export type OperationSource = (typeof OPERATION_SOURCES)[number];

export interface Operation {
  operationId: string;
  pluginId: string;
  source: OperationSource;
  action: string;
  status: OperationStatus;
  workspaceId: string | null;
  processId: string | null;
  input: unknown;
  output: unknown;
  error: unknown;
  inputTruncated: boolean;
  outputTruncated: boolean;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
}

export interface OperationStart {
  pluginId: string;
  source: OperationSource;
  action: string;
  input?: unknown;
  workspaceId?: string | null;
  processId?: string | null;
}
