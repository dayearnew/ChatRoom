import { EventEmitter } from "node:events";
import { appendFile, mkdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { SecretRedactor } from "../../core/operations/redactor.js";
import type {
  SystemLogLevel,
  SystemLogRecord,
  SystemLogSink,
} from "../../core/logging/types.js";
export type {
  SystemLogLevel,
  SystemLogRecord,
} from "../../core/logging/types.js";

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_FILES = 5;

export class SystemLogger implements SystemLogSink {
  readonly filePath: string;
  private readonly redactor = new SecretRedactor();
  private readonly emitter = new EventEmitter();
  private queue: Promise<void> = Promise.resolve();
  private currentBytes: number | null = null;
  private fileDisabled = false;
  private fileWarningShown = false;
  private lastTimestampMs = 0;

  constructor(dataDir: string) {
    this.filePath = path.join(dataDir, "logs", "chatroom.log");
  }

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

  subscribe(listener: (record: SystemLogRecord) => void): () => void {
    this.emitter.on("record", listener);
    return () => this.emitter.off("record", listener);
  }

  async flush(): Promise<void> {
    await this.queue;
  }

  private write(
    level: SystemLogLevel,
    module: string,
    event: string,
    message: string,
    data?: Record<string, unknown>,
  ): void {
    const redacted = this.redactor.redact({
      message,
      ...(data ? { data: normalizeValue(data) } : {}),
    }) as { message: string; data?: Record<string, unknown> };
    const record: SystemLogRecord = {
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
    this.emitter.emit("record", record);
    if (this.fileDisabled) return;
    const line = `${JSON.stringify(record)}\n`;
    this.queue = this.queue
      .then(() => this.append(line))
      .catch((error) => this.disableFile(error));
  }

  private nextTimestamp(): string {
    const now = Date.now();
    this.lastTimestampMs = Math.max(now, this.lastTimestampMs + 1);
    return new Date(this.lastTimestampMs).toISOString();
  }

  private writeConsole(record: SystemLogRecord): void {
    const suffix = record.data ? ` ${JSON.stringify(record.data)}` : "";
    const line = `[${record.level.toUpperCase()}] [${record.module}] ${record.message}${suffix}`;
    if (record.level === "error") console.error(line);
    else if (record.level === "warn") console.warn(line);
    else console.log(line);
  }

  private async append(line: string): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    if (this.currentBytes === null) {
      this.currentBytes = await stat(this.filePath)
        .then((value) => value.size)
        .catch((error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") return 0;
          throw error;
        });
    }
    const bytes = Buffer.byteLength(line);
    if (this.currentBytes > 0 && this.currentBytes + bytes > MAX_FILE_BYTES) {
      await this.rotate();
      this.currentBytes = 0;
    }
    await appendFile(this.filePath, line, { encoding: "utf8", mode: 0o600 });
    this.currentBytes += bytes;
  }

  private async rotate(): Promise<void> {
    const oldest = `${this.filePath}.${MAX_FILES - 1}`;
    await rm(oldest, { force: true });
    for (let index = MAX_FILES - 2; index >= 1; index -= 1) {
      await renameIfExists(
        `${this.filePath}.${index}`,
        `${this.filePath}.${index + 1}`,
      );
    }
    await renameIfExists(this.filePath, `${this.filePath}.1`);
  }

  private disableFile(error: unknown): void {
    this.fileDisabled = true;
    this.currentBytes = null;
    if (this.fileWarningShown) return;
    this.fileWarningShown = true;
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[WARN] [logging] File logging unavailable: ${message}`);
  }
}

async function renameIfExists(from: string, to: string): Promise<void> {
  try {
    await rename(from, to);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

function normalizeValue(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      ...(value.cause ? { cause: normalizeValue(value.cause, seen) } : {}),
    };
  }
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return "[circular]";
  seen.add(value);
  if (Array.isArray(value))
    return value.map((item) => normalizeValue(item, seen));
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key,
      normalizeValue(item, seen),
    ]),
  );
}
