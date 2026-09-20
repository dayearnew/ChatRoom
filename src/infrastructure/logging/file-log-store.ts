import { appendFile, mkdir, open, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { ChatRoomError } from "#core/errors/chatroom-error";
import type {
  LogLevel,
  LogPage,
  LogQuery,
  LogRecord,
} from "#core/logging/types";

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_FILES = 5;
const READ_CHUNK_BYTES = 64 * 1024;

interface LogCursor {
  timestamp: string;
  id: string;
}

export class FileLogStore {
  readonly filePath: string;
  private currentBytes: number | null = null;

  constructor(dataDir: string) {
    this.filePath = path.join(dataDir, "logs", "chatroom.log");
  }

  async append(record: LogRecord): Promise<void> {
    const line = `${JSON.stringify(record)}\n`;
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

  async list(query: LogQuery): Promise<LogPage> {
    const cursor = query.cursor ? decodeCursor(query.cursor) : null;
    let cursorPassed = cursor === null;
    const matches: LogRecord[] = [];
    const wanted = query.limit + 1;

    for (
      let index = 0;
      index < MAX_FILES && matches.length < wanted;
      index += 1
    ) {
      const file = index === 0 ? this.filePath : `${this.filePath}.${index}`;
      for await (const line of readLinesReverse(file)) {
        const record = parseRecord(line);
        if (!record) continue;

        if (!cursorPassed && cursor) {
          if (
            record.id === cursor.id &&
            record.timestamp === cursor.timestamp
          ) {
            cursorPassed = true;
            continue;
          }
          if (record.timestamp < cursor.timestamp) cursorPassed = true;
          else continue;
        }

        if (query.levels && !query.levels.has(record.level)) continue;
        if (query.modules && !query.modules.has(record.module)) continue;

        matches.push(record);
        if (matches.length >= wanted) break;
      }
    }

    const hasMore = matches.length > query.limit;
    const items = hasMore ? matches.slice(0, query.limit) : matches;
    const last = items.at(-1);
    return {
      items,
      nextCursor: hasMore && last ? encodeCursor(last) : null,
    };
  }

  private async rotate(): Promise<void> {
    await rm(`${this.filePath}.${MAX_FILES - 1}`, { force: true });
    for (let index = MAX_FILES - 2; index >= 1; index -= 1) {
      await renameIfExists(
        `${this.filePath}.${index}`,
        `${this.filePath}.${index + 1}`,
      );
    }
    await renameIfExists(this.filePath, `${this.filePath}.1`);
  }
}

async function* readLinesReverse(file: string): AsyncGenerator<string> {
  const handle = await open(file, "r").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (!handle) return;

  try {
    const { size } = await handle.stat();
    let position = size;
    let remainder = Buffer.alloc(0);

    while (position > 0) {
      const length = Math.min(READ_CHUNK_BYTES, position);
      position -= length;
      const buffer = Buffer.allocUnsafe(length);
      let offset = 0;
      while (offset < length) {
        const { bytesRead } = await handle.read(
          buffer,
          offset,
          length - offset,
          position + offset,
        );
        if (bytesRead === 0) break;
        offset += bytesRead;
      }

      const chunk = Buffer.concat([buffer.subarray(0, offset), remainder]);
      let end = chunk.length;
      for (let index = chunk.length - 1; index >= 0; index -= 1) {
        if (chunk[index] !== 0x0a) continue;
        const line = chunk
          .subarray(index + 1, end)
          .toString("utf8")
          .trim();
        if (line) yield line;
        end = index;
      }
      remainder = chunk.subarray(0, end);
    }

    const firstLine = remainder.toString("utf8").trim();
    if (firstLine) yield firstLine;
  } finally {
    await handle.close();
  }
}

async function renameIfExists(from: string, to: string): Promise<void> {
  try {
    await rename(from, to);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

function parseRecord(line: string): LogRecord | null {
  try {
    const value = JSON.parse(line) as Partial<LogRecord>;
    if (
      typeof value.id !== "string" ||
      typeof value.timestamp !== "string" ||
      !isLevel(value.level) ||
      typeof value.module !== "string" ||
      typeof value.event !== "string" ||
      typeof value.message !== "string"
    )
      return null;
    return value as LogRecord;
  } catch {
    return null;
  }
}

function isLevel(value: unknown): value is LogLevel {
  return (
    value === "debug" ||
    value === "info" ||
    value === "warn" ||
    value === "error"
  );
}

function encodeCursor(record: LogRecord): string {
  return Buffer.from(
    JSON.stringify({ timestamp: record.timestamp, id: record.id }),
    "utf8",
  ).toString("base64url");
}

function decodeCursor(cursor: string): LogCursor {
  try {
    const value = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    ) as Partial<LogCursor>;
    if (
      typeof value.timestamp !== "string" ||
      Number.isNaN(Date.parse(value.timestamp)) ||
      typeof value.id !== "string" ||
      !value.id
    )
      throw new Error();
    return { timestamp: value.timestamp, id: value.id };
  } catch {
    throw new ChatRoomError("INVALID_INPUT", "Invalid log cursor");
  }
}
