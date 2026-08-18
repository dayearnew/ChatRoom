/**
 * Owns all ChatRoom-managed process lifecycle, timeout handling, output buffering, stdin, and process operation events.
 * Platform-specific creation details are delegated to pipe/PTY backends.
 */
import { randomUUID } from "node:crypto";
import { ChatRoomError } from "../../core/errors/chatroom-error.js";
import { childEnvironment } from "../../core/runtime/child-environment.js";
import { HeadTailBuffer } from "./head-tail-buffer.js";
import type {
  ProcessId,
  ProcessSnapshot,
  ProcessStartRequest,
} from "./types.js";
import type { RuntimeEventBus } from "../../app/event-bus.js";
import type { OperationLog } from "../../operations/operation-log.js";
import type { OperationSource } from "../../core/operations/types.js";
import type { BackendProcess, ProcessBackend } from "./backend.js";

interface ManagedProcess {
  request: ProcessStartRequest;
  backend: BackendProcess;
  stdout: HeadTailBuffer;
  stderr: HeadTailBuffer;
  state: ProcessSnapshot["state"];
  startedAt: Date;
  finishedAt: Date | null;
  exitCode: number | null;
  signal: string | null;
  timeout: NodeJS.Timeout | null;
  forceTimeout: NodeJS.Timeout | null;
  timedOut: boolean;
  operationId: string;
  settled: Promise<ProcessSnapshot>;
  resolveSettled: (snapshot: ProcessSnapshot) => void;
}

interface ProcessOperationContext {
  source: OperationSource;
  action?: string;
  operationId?: string;
}

export class ProcessSupervisor {
  private readonly processes = new Map<ProcessId, ManagedProcess>();
  private shuttingDown = false;

  constructor(
    private readonly backends: { pipe: ProcessBackend; pty: ProcessBackend },
    private readonly operations: OperationLog,
    private readonly eventBus: RuntimeEventBus,
    private readonly maxOutputBytes: number,
    private readonly defaultTimeoutMs: number,
    private readonly maxCompletedProcesses: number,
  ) {}

  async start(
    request: ProcessStartRequest,
    operationContext: ProcessOperationContext,
  ): Promise<ProcessSnapshot> {
    if (this.shuttingDown)
      throw new ChatRoomError(
        "CONFLICT",
        "Process supervisor is shutting down",
      );
    const processId = `proc_${randomUUID()}`;
    const args = request.args ?? [];
    const adoptedOperation = operationContext.operationId !== undefined;
    const operationId =
      operationContext.operationId ??
      this.operations.start({
        pluginId: "process",
        source: operationContext.source,
        action: operationContext.action ?? "start",
        processId,
        input: {
          command: request.command,
          args,
          cwd: request.cwd,
          pty: request.pty ?? false,
          timeoutMs: request.timeoutMs ?? this.defaultTimeoutMs,
          env: request.env ?? {},
        },
      }).operationId;
    if (adoptedOperation) this.operations.associate(operationId, { processId });
    let backend: BackendProcess;
    try {
      // Child environments inherit only the runtime allowlist, then apply explicit request overrides.
      backend = await (
        request.pty ? this.backends.pty : this.backends.pipe
      ).start(request.command, args, {
        cwd: request.cwd,
        env: childEnvironment(request.env),
      });
    } catch (error) {
      if (!adoptedOperation)
        this.operations.finish(operationId, "error", null, error);
      throw new ChatRoomError(
        "PROCESS_FAILED",
        `Failed to start process: ${request.command}`,
        undefined,
        { cause: error },
      );
    }
    let resolveSettled!: (snapshot: ProcessSnapshot) => void;
    const settled = new Promise<ProcessSnapshot>((resolve) => {
      resolveSettled = resolve;
    });
    const managed: ManagedProcess = {
      request,
      backend,
      stdout: new HeadTailBuffer(this.maxOutputBytes),
      stderr: new HeadTailBuffer(this.maxOutputBytes),
      state: "running",
      startedAt: new Date(),
      finishedAt: null,
      exitCode: null,
      signal: null,
      timeout: null,
      forceTimeout: null,
      timedOut: false,
      operationId,
      settled,
      resolveSettled,
    };
    this.processes.set(processId, managed);
    backend.onStdout((chunk) => this.onOutput(processId, "stdout", chunk));
    backend.onStderr((chunk) => this.onOutput(processId, "stderr", chunk));
    backend.onExit((exit) =>
      this.onExit(processId, exit.exitCode, exit.signal),
    );
    const timeoutMs = request.timeoutMs ?? this.defaultTimeoutMs;
    if (timeoutMs > 0)
      managed.timeout = setTimeout(() => {
        if (managed.state !== "running") return;
        managed.timedOut = true;
        // Timeouts first request graceful termination and escalate to SIGKILL only if the backend remains alive.
        managed.backend.kill("SIGTERM");
        managed.forceTimeout = setTimeout(() => {
          if (managed.state === "running") managed.backend.kill("SIGKILL");
        }, 2000).unref();
      }, timeoutMs).unref();
    const snapshot = this.snapshotOf(processId, managed);
    this.eventBus.emit({ type: "process", process: snapshot });
    return snapshot;
  }

  read(processId: ProcessId): ProcessSnapshot {
    const item = this.require(processId);
    return this.snapshotOf(processId, item);
  }
  list(): ProcessSnapshot[] {
    return [...this.processes.entries()]
      .map(([id, item]) => this.snapshotOf(id, item))
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }
  write(processId: ProcessId, data: string): ProcessSnapshot {
    const item = this.requireRunning(processId);
    item.backend.write(data);
    return this.snapshotOf(processId, item);
  }
  kill(processId: ProcessId, force = false): ProcessSnapshot {
    const item = this.requireRunning(processId);
    item.backend.kill(force ? "SIGKILL" : "SIGTERM");
    return this.snapshotOf(processId, item);
  }

  async shutdown(): Promise<void> {
    this.shuttingDown = true;
    const running = [...this.processes.entries()].filter(
      ([, item]) => item.state === "running",
    );
    for (const [, item] of running) item.backend.kill("SIGTERM");
    await Promise.race([
      Promise.allSettled(running.map(([, item]) => item.settled)),
      new Promise((resolve) => setTimeout(resolve, 1500)),
    ]);
    const survivors = running.filter(([, item]) => item.state === "running");
    for (const [, item] of survivors) item.backend.kill("SIGKILL");
    if (survivors.length) {
      await Promise.race([
        Promise.allSettled(survivors.map(([, item]) => item.settled)),
        new Promise((resolve) => setTimeout(resolve, 1500)),
      ]);
      // A backend that does not report close after SIGKILL must still be settled before SQLite closes.
      for (const [processId, item] of survivors)
        if (item.state === "running") this.onExit(processId, null, "SIGKILL");
    }
  }

  private onOutput(
    processId: string,
    stream: "stdout" | "stderr",
    chunk: Buffer,
  ): void {
    const item = this.processes.get(processId);
    if (!item || item.state !== "running") return;
    // Store only bounded head/tail output while forwarding live chunks to SSE.
    (stream === "stdout" ? item.stdout : item.stderr).append(chunk);
    const text = chunk.toString("utf8");
    this.eventBus.emit({
      type: "process-output",
      processId,
      stream,
      chunk: text,
    });
    const snapshot = this.snapshotOf(processId, item);
    this.operations.updateRunning(item.operationId, {
      stdout: snapshot.stdout,
      stderr: snapshot.stderr,
      outputTruncated: snapshot.outputTruncated,
      pid: snapshot.pid,
    });
  }
  private onExit(
    processId: string,
    exitCode: number | null,
    signal: string | null,
  ): void {
    const item = this.processes.get(processId);
    if (!item || item.state !== "running") return;
    if (item.timeout) clearTimeout(item.timeout);
    if (item.forceTimeout) clearTimeout(item.forceTimeout);
    // A signal is represented as killed/cancelled; otherwise zero means exited and non-zero means failed.
    item.finishedAt = new Date();
    item.exitCode = exitCode;
    item.signal = signal;
    item.state = signal ? "killed" : exitCode === 0 ? "exited" : "failed";
    const snapshot = this.snapshotOf(processId, item);
    this.operations.finish(
      item.operationId,
      exitCode === 0 && !signal ? "success" : signal ? "cancelled" : "error",
      {
        stdout: snapshot.stdout,
        stderr: snapshot.stderr,
        exitCode,
        signal,
        durationMs: snapshot.durationMs,
        outputTruncated: snapshot.outputTruncated,
        timedOut: snapshot.timedOut,
      },
      exitCode === 0 && !signal
        ? undefined
        : { exitCode, signal, timedOut: snapshot.timedOut },
    );
    this.eventBus.emit({ type: "process", process: snapshot });
    item.resolveSettled(snapshot);
    this.trimCompletedProcesses();
  }

  private trimCompletedProcesses(): void {
    const completed = [...this.processes.entries()]
      .filter(([, item]) => item.state !== "running")
      .sort(([, a], [, b]) => b.startedAt.getTime() - a.startedAt.getTime());
    for (const [processId] of completed.slice(this.maxCompletedProcesses)) {
      this.processes.delete(processId);
    }
  }
  private require(processId: string): ManagedProcess {
    const item = this.processes.get(processId);
    if (!item)
      throw new ChatRoomError("NOT_FOUND", `Unknown ProcessId: ${processId}`);
    return item;
  }
  private requireRunning(processId: string): ManagedProcess {
    const item = this.require(processId);
    if (item.state !== "running")
      throw new ChatRoomError(
        "CONFLICT",
        `Process is not running: ${processId}`,
      );
    return item;
  }
  private snapshotOf(id: string, item: ManagedProcess): ProcessSnapshot {
    const stdout = item.stdout.snapshot(),
      stderr = item.stderr.snapshot(),
      finish = item.finishedAt?.getTime() ?? Date.now();
    return {
      processId: id,
      command: item.request.command,
      args: item.request.args ?? [],
      cwd: item.request.cwd,
      pid: item.backend.pid,
      state: item.state,
      startedAt: item.startedAt.toISOString(),
      finishedAt: item.finishedAt?.toISOString() ?? null,
      durationMs: Math.max(0, finish - item.startedAt.getTime()),
      exitCode: item.exitCode,
      signal: item.signal,
      stdout: stdout.text,
      stderr: stderr.text,
      outputTruncated: stdout.outputTruncated || stderr.outputTruncated,
      timedOut: item.timedOut,
      operationId: item.operationId,
    };
  }
}
