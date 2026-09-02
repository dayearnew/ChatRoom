import type { Operation, OperationStatus } from "./types.js";

export interface OperationQuery {
  limit?: number;
  offset?: number;
  pluginId?: string;
  status?: OperationStatus | string;
}

export interface OperationRepository {
  insert(operation: Operation): void;
  update(operation: Operation): void;
  get(operationId: string): Operation | null;
  list(query?: OperationQuery): Operation[];
  clearHistory(): { deleted: number; preserved: number };
  reconcileRunning(finishedAt: string): number;
}
