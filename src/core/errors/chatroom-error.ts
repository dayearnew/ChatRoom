export const ERROR_CODES = [
  "INVALID_INPUT",
  "NOT_FOUND",
  "FORBIDDEN",
  "CONFLICT",
  "UNSUPPORTED",
  "PROCESS_FAILED",
  "INTERNAL",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export class ChatRoomError extends Error {
  readonly code: ErrorCode;
  readonly details?: unknown;

  constructor(
    code: ErrorCode,
    message: string,
    details?: unknown,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ChatRoomError";
    this.code = code;
    this.details = details;
  }
}

export function asChatRoomError(error: unknown): ChatRoomError {
  if (error instanceof ChatRoomError) return error;
  if (error instanceof Error) {
    return new ChatRoomError("INTERNAL", error.message, undefined, {
      cause: error,
    });
  }
  return new ChatRoomError("INTERNAL", "Unknown internal error", {
    value: String(error),
  });
}
