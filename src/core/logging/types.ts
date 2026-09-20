export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogRecord {
  id: string;
  timestamp: string;
  level: LogLevel;
  module: string;
  event: string;
  message: string;
  data?: Record<string, unknown>;
}

export interface LogQuery {
  limit: number;
  cursor?: string;
  levels?: ReadonlySet<LogLevel>;
  modules?: ReadonlySet<string>;
}

export interface LogPage {
  items: LogRecord[];
  nextCursor: string | null;
}

export interface LogWriter {
  debug(
    module: string,
    event: string,
    message: string,
    data?: Record<string, unknown>,
  ): void;
  info(
    module: string,
    event: string,
    message: string,
    data?: Record<string, unknown>,
  ): void;
  warn(
    module: string,
    event: string,
    message: string,
    data?: Record<string, unknown>,
  ): void;
  error(
    module: string,
    event: string,
    message: string,
    data?: Record<string, unknown>,
  ): void;
}

export interface LogService extends LogWriter {
  list(query: LogQuery): Promise<LogPage>;
  subscribe(listener: (record: LogRecord) => void): () => void;
  flush(): Promise<void>;
}
