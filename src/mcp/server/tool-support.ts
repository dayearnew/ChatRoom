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

export const localWrite = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: true,
  openWorldHint: false,
} satisfies ToolAnnotations;

export const localMutation = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
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

export const workspaceOutputSchema = z.object({
  id: z.string(),
  root: z.string(),
  sourceRoot: z.string(),
  mode: z.enum(["checkout", "worktree"]),
  createdAt: z.string(),
  lastUsedAt: z.string(),
  instructions: z.array(z.string()),
  skills: z.array(z.string()),
  capabilities: z.object({
    filesystem: z.literal("read-write"),
    git: z.boolean(),
    skills: z.boolean(),
  }),
});

export const fileReadOutputSchema = z.object({
  content: z.string(),
  bytes: z.number().int().nonnegative(),
  truncated: z.boolean(),
});

export const fileWriteOutputSchema = z.object({
  path: z.string(),
  bytes: z.number().int().nonnegative(),
});

export const fileInfoSchema = z.object({
  path: z.string(),
  type: z.enum(["file", "directory", "symlink"]),
  size: z.number().int().nonnegative(),
  modifiedAt: z.string(),
});

export const searchMatchSchema = z.object({
  path: z.string(),
  line: z.number().int().positive(),
  column: z.number().int().positive(),
  preview: z.string(),
});

export const changeSetSchema = z.object({
  files: z.array(z.string()),
  replacements: z.number().int().nonnegative(),
  bytesBefore: z.number().int().nonnegative(),
  bytesAfter: z.number().int().nonnegative(),
});

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
): (input: T) => Promise<CallToolResult> {
  return async (input: T) => {
    try {
      const value = await operation(input);
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
