import { z } from "zod";
import {
  ChatRoomError,
  type ErrorCode,
} from "../../core/errors/chatroom-error.js";
import {
  computerActionResultSchema,
  computerNativeStatusSchema,
  computerSnapshotSchema,
} from "./computer-schemas.js";
import type {
  ComputerActionResult,
  ComputerSnapshot,
  ComputerStatus,
} from "./types.js";

export const COMPUTER_NATIVE_PROTOCOL_VERSION = 1;

export type ComputerNativeMethod =
  "status" | "requestPermission" | "snapshot" | "action";

export interface ComputerNativeResultMap {
  status: Omit<ComputerStatus, "settings">;
  requestPermission: Omit<ComputerStatus, "settings">;
  snapshot: ComputerSnapshot;
  action: ComputerActionResult;
}

export interface ComputerNativeError {
  code?: string;
  message: string;
}

const responseEnvelopeSchema = z
  .object({
    protocol: z.literal(COMPUTER_NATIVE_PROTOCOL_VERSION).optional(),
    id: z.string(),
    result: z.unknown().optional(),
    error: z
      .object({
        code: z.string().optional(),
        message: z.string(),
      })
      .optional(),
  })
  .refine((value) => value.result !== undefined || value.error !== undefined, {
    message: "Native response must contain result or error",
  });

export function parseNativeEnvelope(value: unknown): {
  id: string;
  result?: unknown;
  error?: ComputerNativeError;
} {
  const parsed = responseEnvelopeSchema.safeParse(value);
  if (!parsed.success) {
    throw new ChatRoomError(
      "INTERNAL",
      "Computer helper returned an invalid protocol response",
      { issues: parsed.error.issues },
    );
  }
  return {
    id: parsed.data.id,
    ...(parsed.data.result === undefined ? {} : { result: parsed.data.result }),
    ...(parsed.data.error === undefined
      ? {}
      : {
          error: {
            message: parsed.data.error.message,
            ...(parsed.data.error.code === undefined
              ? {}
              : { code: parsed.data.error.code }),
          },
        }),
  };
}

export function parseNativeResult<M extends ComputerNativeMethod>(
  method: M,
  value: unknown,
): ComputerNativeResultMap[M] {
  const schema =
    method === "status" || method === "requestPermission"
      ? computerNativeStatusSchema
      : method === "snapshot"
        ? computerSnapshotSchema
        : computerActionResultSchema;
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new ChatRoomError(
      "INTERNAL",
      `Computer helper returned an invalid ${method} result`,
      { issues: parsed.error.issues },
    );
  }
  return parsed.data as ComputerNativeResultMap[M];
}

export function nativeError(error: ComputerNativeError): ChatRoomError {
  return new ChatRoomError(nativeErrorCode(error.code), error.message, {
    nativeCode: error.code ?? null,
  });
}

function nativeErrorCode(code: string | undefined): ErrorCode {
  switch (code) {
    case "invalid_request":
      return "INVALID_INPUT";
    case "not_found":
      return "NOT_FOUND";
    case "permission_required":
      return "FORBIDDEN";
    case "stale_snapshot":
      return "CONFLICT";
    case "unsupported":
      return "UNSUPPORTED";
    default:
      return "INTERNAL";
  }
}
