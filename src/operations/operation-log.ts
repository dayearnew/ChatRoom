import { randomUUID } from "node:crypto";
import type {
  Operation,
  OperationStart,
  OperationStatus,
} from "../core/operations/types.js";
import { boundJson } from "../core/operations/bounded-value.js";
import { SecretRedactor } from "../core/operations/redactor.js";
import {
  asChatRoomError,
  ChatRoomError,
} from "../core/errors/chatroom-error.js";
import type {
  OperationQuery,
  OperationRepository,
} from "../core/operations/repository.js";
import type { RuntimeEventBus } from "../app/event-bus.js";

/** Persists redacted, bounded operations produced by ChatRoom plugins. */
export class OperationLog {
  private readonly redactor = new SecretRedactor();

  constructor(
    private readonly repository: OperationRepository,
    private readonly eventBus: RuntimeEventBus,
    private readonly maxPayloadBytes: number,
  ) {}

  start(request: OperationStart): Operation {
    const input = boundJson(
      this.redactor.redact(request.input ?? null),
      this.maxPayloadBytes,
    );
    const operation: Operation = {
      operationId: randomUUID(),
      pluginId: request.pluginId,
      source: request.source,
      action: request.action,
      status: "running",
      workspaceId: request.workspaceId ?? null,
      processId: request.processId ?? null,
      input: input.value,
      output: null,
      error: null,
      inputTruncated: input.truncated,
      outputTruncated: false,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      durationMs: null,
    };
    this.repository.insert(operation);
    this.eventBus.emit({ type: "operation", operation });
    return operation;
  }

  finish(
    operationId: string,
    status: Exclude<OperationStatus, "running">,
    output?: unknown,
    error?: unknown,
  ): Operation {
    const operation = this.require(operationId);
    const finishedAt = new Date();
    const bounded = boundJson(
      this.redactor.redact(output ?? null),
      this.maxPayloadBytes,
    );
    operation.status = status;
    operation.output = bounded.value;
    operation.outputTruncated = bounded.truncated;
    operation.error = error
      ? boundJson(this.redactor.redact(error), this.maxPayloadBytes).value
      : null;
    operation.finishedAt = finishedAt.toISOString();
    operation.durationMs = Math.max(
      0,
      finishedAt.getTime() - new Date(operation.startedAt).getTime(),
    );
    this.repository.update(operation);
    this.eventBus.emit({ type: "operation", operation });
    return operation;
  }

  updateRunning(operationId: string, output: unknown): Operation {
    const operation = this.require(operationId);
    if (operation.status !== "running") return operation;
    const bounded = boundJson(
      this.redactor.redact(output),
      this.maxPayloadBytes,
    );
    operation.output = bounded.value;
    operation.outputTruncated = bounded.truncated;
    this.repository.update(operation);
    this.eventBus.emit({ type: "operation", operation });
    return operation;
  }

  async run<T>(request: OperationStart, action: () => Promise<T>): Promise<T> {
    const operation = this.start(request);
    try {
      const result = await action();
      this.finish(operation.operationId, "success", result);
      return result;
    } catch (error) {
      const normalized = asChatRoomError(error);
      this.finish(operation.operationId, "error", null, {
        code: normalized.code,
        message: normalized.message,
        details: normalized.details,
      });
      throw error;
    }
  }

  list(query?: OperationQuery): Operation[] {
    return this.repository.list(query);
  }

  get(operationId: string): Operation | null {
    return this.repository.get(operationId);
  }

  associate(
    operationId: string,
    references: { workspaceId?: string | null; processId?: string | null },
  ): Operation {
    const operation = this.require(operationId);
    if (references.workspaceId !== undefined)
      operation.workspaceId = references.workspaceId;
    if (references.processId !== undefined)
      operation.processId = references.processId;
    this.repository.update(operation);
    this.eventBus.emit({ type: "operation", operation });
    return operation;
  }

  clearHistory(): { deleted: number; preserved: number } {
    const result = this.repository.clearHistory();
    this.eventBus.emit({ type: "operations-cleared", ...result });
    return result;
  }

  reconcileInterrupted(): number {
    return this.repository.reconcileRunning(new Date().toISOString());
  }

  private require(operationId: string): Operation {
    const operation = this.repository.get(operationId);
    if (!operation)
      throw new ChatRoomError(
        "NOT_FOUND",
        `Operation not found: ${operationId}`,
      );
    return operation;
  }
}
