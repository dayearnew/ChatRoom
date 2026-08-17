/**
 * Typed error vocabulary exposed across ChatRoom application boundaries.
 *
 * Presentation adapters translate these stable codes into protocol responses. Domain/application
 * code should prefer ChatRoomError over parsing message text or leaking implementation-specific
 * filesystem, SQLite, process, or SDK errors to external callers.
 */
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

/** Error carrying a stable machine-readable code plus optional structured diagnostic details. */
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

/**
 * Normalize an arbitrary thrown value at an application or protocol boundary.
 *
 * Existing ChatRoomError instances retain their public code. Native Error values become INTERNAL
 * while preserving the original error as `cause`; non-Error throws are converted as well so every
 * external path observes the same error vocabulary.
 */
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
