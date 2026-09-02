import {
  type CallToolResult,
  type ToolAnnotations,
} from "@modelcontextprotocol/server";
import { z } from "zod";
import { asChatRoomError } from "../../core/errors/chatroom-error.js";

export const closedRead = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} satisfies ToolAnnotations;

export const destructiveLocalMutation = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: false,
} satisfies ToolAnnotations;

export const openWorldMutation = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: true,
} satisfies ToolAnnotations;

export const processSnapshotSchema = z.object({
  processId: z.string(),
  command: z.string(),
  args: z.array(z.string()),
  cwd: z.string(),
  pid: z.number().int().nullable(),
  state: z.enum(["running", "exited", "killed", "failed"]),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
  durationMs: z.number().nonnegative(),
  exitCode: z.number().int().nullable(),
  signal: z.string().nullable(),
  stdout: z.string(),
  stderr: z.string(),
  outputTruncated: z.boolean(),
  timedOut: z.boolean(),
  operationId: z.string(),
});

export function mcpTool<T>(
  operation: (input: T) => Promise<unknown> | unknown,
  present?: (value: unknown) => CallToolResult,
): (input: T) => Promise<CallToolResult> {
  return async (input: T) => {
    try {
      const value = await operation(input);
      if (present) return present(value);
      return {
        content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
        structuredContent: asRecord(value),
      };
    } catch (error) {
      const normalized = asChatRoomError(error);
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: JSON.stringify({
              code: normalized.code,
              message: normalized.message,
              details: normalized.details ?? null,
            }),
          },
        ],
      };
    }
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : { value };
}
