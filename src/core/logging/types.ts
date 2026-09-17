export type SystemLogLevel = "debug" | "info" | "warn" | "error";

export interface SystemLogRecord {
  id: string;
  timestamp: string;
  level: SystemLogLevel;
  module: string;
  event: string;
  message: string;
  data?: Record<string, unknown>;
}

export interface SystemLogSink {
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
  subscribe(listener: (record: SystemLogRecord) => void): () => void;
  flush(): Promise<void>;
}
