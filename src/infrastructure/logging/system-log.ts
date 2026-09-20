import { randomUUID } from "node:crypto";
import { SecretRedactor } from "#core/operations/redactor";
import type {
  LogLevel,
  LogPage,
  LogQuery,
  LogRecord,
  LogService,
} from "#core/logging/types";
import { FileLogStore } from "./file-log-store.js";

export class SystemLog implements LogService {
  private readonly redactor = new SecretRedactor();
  private readonly listeners = new Set<(record: LogRecord) => void>();
  private queue: Promise<void> = Promise.resolve();
  private persistenceDisabled = false;
  private lastTimestampMs = 0;

  constructor(private readonly store: FileLogStore) {}

  debug(
    module: string,
    event: string,
    message: string,
    data?: Record<string, unknown>,
  ): void {
    this.write("debug", module, event, message, data);
  }

  info(
    module: string,
    event: string,
    message: string,
    data?: Record<string, unknown>,
  ): void {
    this.write("info", module, event, message, data);
  }

  warn(
    module: string,
    event: string,
    message: string,
    data?: Record<string, unknown>,
  ): void {
    this.write("warn", module, event, message, data);
  }

  error(
    module: string,
    event: string,
    message: string,
    data?: Record<string, unknown>,
  ): void {
    this.write("error", module, event, message, data);
  }

  async list(query: LogQuery): Promise<LogPage> {
    await this.flush();
    return this.store.list(query);
  }

  subscribe(listener: (record: LogRecord) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async flush(): Promise<void> {
    await this.queue;
  }

  private write(
    level: LogLevel,
    module: string,
    event: string,
    message: string,
    data?: Record<string, unknown>,
  ): void {
    const redacted = this.redactor.redact({
      message,
      ...(data ? { data: normalizeValue(data) } : {}),
    }) as { message: string; data?: Record<string, unknown> };

    const record: LogRecord = {
      id: randomUUID(),
      timestamp: this.nextTimestamp(),
      level,
      module,
      event,
      message: redacted.message,
      ...(redacted.data && Object.keys(redacted.data).length
        ? { data: redacted.data }
        : {}),
    };

    this.writeConsole(record);
    for (const listener of this.listeners) {
      try {
        listener(record);
      } catch {
        this.listeners.delete(listener);
        console.warn("[WARN] [logging] Log subscriber removed after failure");
      }
    }

    if (this.persistenceDisabled) return;
    this.queue = this.queue
      .then(() => this.store.append(record))
      .catch((error) => this.disablePersistence(error));
  }

  private nextTimestamp(): string {
    const now = Date.now();
    this.lastTimestampMs = Math.max(now, this.lastTimestampMs + 1);
    return new Date(this.lastTimestampMs).toISOString();
  }

  private writeConsole(record: LogRecord): void {
    const suffix = record.data ? ` ${JSON.stringify(record.data)}` : "";
    const line = `[${record.level.toUpperCase()}] [${record.module}] ${record.message}${suffix}`;
    if (record.level === "error") console.error(line);
    else if (record.level === "warn") console.warn(line);
    else console.log(line);
  }

  private disablePersistence(error: unknown): void {
    if (this.persistenceDisabled) return;
    this.persistenceDisabled = true;
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[WARN] [logging] File logging unavailable: ${message}`);
  }
}

function normalizeValue(value: unknown, seen = new WeakSet<object>()): unknown {
  if (typeof value === "bigint") return value.toString();
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return "[circular]";
  seen.add(value);
  try {
    if (value instanceof Error) {
      return {
        name: value.name,
        message: value.message,
        ...(value.cause ? { cause: normalizeValue(value.cause, seen) } : {}),
      };
    }
    if (Array.isArray(value))
      return value.map((item) => normalizeValue(item, seen));
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        normalizeValue(item, seen),
      ]),
    );
  } finally {
    seen.delete(value);
  }
}
