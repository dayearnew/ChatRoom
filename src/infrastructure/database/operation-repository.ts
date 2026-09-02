import type { Operation } from "../../core/operations/types.js";
import type {
  OperationQuery,
  OperationRepository as OperationRepositoryPort,
} from "../../core/operations/repository.js";
import type { AppDatabase } from "./app-database.js";

export class OperationRepository implements OperationRepositoryPort {
  constructor(private readonly database: AppDatabase) {}

  insert(operation: Operation): void {
    this.database.raw
      .prepare(
        `
        INSERT INTO operations(
          operation_id, plugin_id, source, action, status, process_id,
          input_json, output_json, error_json, input_truncated, output_truncated,
          started_at, finished_at, duration_ms
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `,
      )
      .run(...toRowValues(operation));
  }

  update(operation: Operation): void {
    this.database.raw
      .prepare(
        `
        UPDATE operations SET
          plugin_id=?, source=?, action=?, status=?, process_id=?,
          input_json=?, output_json=?, error_json=?, input_truncated=?, output_truncated=?,
          started_at=?, finished_at=?, duration_ms=?
        WHERE operation_id=?
      `,
      )
      .run(...toRowValues(operation).slice(1), operation.operationId);
  }

  get(operationId: string): Operation | null {
    const row = this.database.raw
      .prepare("SELECT * FROM operations WHERE operation_id=?")
      .get(operationId) as OperationRow | undefined;
    return row ? fromRow(row) : null;
  }

  list(query: OperationQuery = {}): Operation[] {
    const where: string[] = [];
    const args: string[] = [];
    if (query.pluginId) {
      where.push("plugin_id=?");
      args.push(query.pluginId);
    }
    if (query.status) {
      where.push("status=?");
      args.push(query.status);
    }
    const limit = Math.min(Math.max(query.limit ?? 100, 1), 500);
    const offset = Math.max(query.offset ?? 0, 0);
    const filter = where.length ? `WHERE ${where.join(" AND ")}` : "";
    return (
      this.database.raw
        .prepare(
          `SELECT * FROM operations ${filter} ORDER BY started_at DESC LIMIT ? OFFSET ?`,
        )
        .all(...args, limit, offset) as unknown as OperationRow[]
    ).map(fromRow);
  }

  reconcileRunning(finishedAt: string): number {
    const result = this.database.raw
      .prepare(
        `
        UPDATE operations
        SET status='cancelled', finished_at=?,
            duration_ms=MAX(0, CAST((julianday(?) - julianday(started_at)) * 86400000 AS INTEGER)),
            error_json=?
        WHERE status='running'
      `,
      )
      .run(
        finishedAt,
        finishedAt,
        JSON.stringify({
          code: "INTERRUPTED",
          message: "Runtime stopped before this operation completed",
        }),
      );
    return Number(result.changes);
  }

  clearHistory(): { deleted: number; preserved: number } {
    const before = (
      this.database.raw
        .prepare("SELECT COUNT(*) AS count FROM operations")
        .get() as {
        count: number;
      }
    ).count;
    this.database.raw
      .prepare("DELETE FROM operations WHERE status != 'running'")
      .run();
    const preserved = (
      this.database.raw
        .prepare("SELECT COUNT(*) AS count FROM operations")
        .get() as {
        count: number;
      }
    ).count;
    return { deleted: before - preserved, preserved };
  }
}

interface OperationRow {
  operation_id: string;
  plugin_id: string;
  source: Operation["source"];
  action: string;
  status: Operation["status"];
  process_id: string | null;
  input_json: string;
  output_json: string;
  error_json: string;
  input_truncated: number;
  output_truncated: number;
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
}

function toRowValues(operation: Operation): Array<string | number | null> {
  return [
    operation.operationId,
    operation.pluginId,
    operation.source,
    operation.action,
    operation.status,
    operation.processId,
    JSON.stringify(operation.input),
    JSON.stringify(operation.output),
    JSON.stringify(operation.error),
    operation.inputTruncated ? 1 : 0,
    operation.outputTruncated ? 1 : 0,
    operation.startedAt,
    operation.finishedAt,
    operation.durationMs,
  ];
}

function fromRow(row: OperationRow): Operation {
  return {
    operationId: row.operation_id,
    pluginId: row.plugin_id,
    source: row.source,
    action: row.action,
    status: row.status,
    processId: row.process_id,
    input: parse(row.input_json),
    output: parse(row.output_json),
    error: parse(row.error_json),
    inputTruncated: Boolean(row.input_truncated),
    outputTruncated: Boolean(row.output_truncated),
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    durationMs: row.duration_ms,
  };
}

function parse(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}
