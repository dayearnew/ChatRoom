import { readFile } from "node:fs/promises";
import type {
  SystemLogLevel,
  SystemLogRecord,
} from "../../core/logging/types.js";

const MAX_FILES = 5;

export interface SystemLogQuery {
  limit: number;
  before?: string;
  levels?: Set<SystemLogLevel>;
  modules?: Set<string>;
}

export interface SystemLogPage {
  items: SystemLogRecord[];
  nextBefore: string | null;
}

export class SystemLogReader {
  constructor(private readonly filePath: string) {}

  async list(query: SystemLogQuery): Promise<SystemLogPage> {
    const matches: SystemLogRecord[] = [];
    const wanted = query.limit + 1;

    for (
      let index = 0;
      index < MAX_FILES && matches.length < wanted;
      index += 1
    ) {
      const file = index === 0 ? this.filePath : `${this.filePath}.${index}`;
      const text = await readFile(file, "utf8").catch(
        (error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") return "";
          throw error;
        },
      );
      if (!text) continue;
      const lines = text.split("\n");
      for (let lineIndex = lines.length - 1; lineIndex >= 0; lineIndex -= 1) {
        const line = lines[lineIndex]?.trim();
        if (!line) continue;
        const record = parseRecord(line);
        if (!record) continue;
        if (query.before && record.timestamp >= query.before) continue;
        if (query.levels && !query.levels.has(record.level)) continue;
        if (query.modules && !query.modules.has(record.module)) continue;
        matches.push(record);
        if (matches.length >= wanted) break;
      }
    }

    const hasMore = matches.length > query.limit;
    const items = hasMore ? matches.slice(0, query.limit) : matches;
    return {
      items,
      nextBefore: hasMore ? (items.at(-1)?.timestamp ?? null) : null,
    };
  }
}

function parseRecord(line: string): SystemLogRecord | null {
  try {
    const value = JSON.parse(line) as Partial<SystemLogRecord>;
    if (
      typeof value.id !== "string" ||
      typeof value.timestamp !== "string" ||
      !isLevel(value.level) ||
      typeof value.module !== "string" ||
      typeof value.event !== "string" ||
      typeof value.message !== "string"
    )
      return null;
    return value as SystemLogRecord;
  } catch {
    return null;
  }
}

function isLevel(value: unknown): value is SystemLogLevel {
  return (
    value === "debug" ||
    value === "info" ||
    value === "warn" ||
    value === "error"
  );
}
