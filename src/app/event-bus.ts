/** Lightweight in-process event bus used to fan runtime changes out to SSE/WebUI observers. */
import { EventEmitter } from "node:events";
import type { Operation } from "../core/operations/types.js";
import type { ProcessSnapshot } from "../plugins/process/types.js";

export type RuntimeEvent =
  | { type: "operation"; operation: Operation }
  | { type: "operations-cleared"; deleted: number; preserved: number }
  | { type: "process"; process: ProcessSnapshot }
  | {
      type: "process-output";
      processId: string;
      stream: "stdout" | "stderr";
      chunk: string;
    };

export class RuntimeEventBus {
  private readonly emitter = new EventEmitter();
  emit(event: RuntimeEvent): void {
    this.emitter.emit("event", event);
  }
  subscribe(listener: (event: RuntimeEvent) => void): () => void {
    this.emitter.on("event", listener);
    return () => this.emitter.off("event", listener);
  }
}
