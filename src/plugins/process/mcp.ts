import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { OperationLog } from "../../operations/operation-log.js";
import {
  closedRead,
  destructiveLocalMutation,
  mcpTool,
  openWorldMutation,
  processSnapshotSchema,
} from "../../mcp/server/tool-support.js";
import type { ProcessSupervisor } from "./process-supervisor.js";

export function registerProcessTools(
  server: McpServer,
  processes: ProcessSupervisor,
  operations: OperationLog,
): void {
  server.registerTool(
    "process_start",
    {
      title: "Start process",
      description:
        "Start a supervised pipe or PTY process. Returns a ProcessId immediately.",
      inputSchema: z.object({
        command: z.string().min(1),
        args: z.array(z.string()).default([]),
        cwd: z.string().default("."),
        env: z.record(z.string(), z.string()).optional(),
        pty: z.boolean().default(false),
        timeoutMs: z.number().int().positive().optional(),
      }),
      outputSchema: processSnapshotSchema,
      annotations: openWorldMutation,
    },
    mcpTool(
      (input: {
        command: string;
        args: string[];
        cwd: string;
        env?: Record<string, string> | undefined;
        pty: boolean;
        timeoutMs?: number | undefined;
      }) =>
        processes.start(
          {
            cwd: input.cwd,
            command: input.command,
            args: input.args,
            ...(input.env ? { env: input.env } : {}),
            pty: input.pty,
            ...(input.timeoutMs === undefined
              ? {}
              : { timeoutMs: input.timeoutMs }),
          },
          { source: "mcp" },
        ),
    ),
  );

  server.registerTool(
    "process_read",
    {
      title: "Read process",
      description: "Read bounded stdout/stderr and current process state.",
      inputSchema: z.object({ processId: z.string() }),
      outputSchema: processSnapshotSchema,
      annotations: closedRead,
    },
    mcpTool((input: { processId: string }) =>
      operations.run(
        {
          pluginId: "process",
          source: "mcp",
          action: "read",
          processId: input.processId,
          input,
        },
        () => Promise.resolve(processes.read(input.processId)),
      ),
    ),
  );

  server.registerTool(
    "process_write",
    {
      title: "Write process stdin",
      description: "Write to stdin of a running process.",
      inputSchema: z.object({ processId: z.string(), data: z.string() }),
      outputSchema: processSnapshotSchema,
      annotations: openWorldMutation,
    },
    mcpTool((input: { processId: string; data: string }) =>
      operations.run(
        {
          pluginId: "process",
          source: "mcp",
          action: "write",
          processId: input.processId,
          input,
        },
        () => Promise.resolve(processes.write(input.processId, input.data)),
      ),
    ),
  );

  server.registerTool(
    "process_kill",
    {
      title: "Stop process",
      description: "Terminate or force-kill a supervised process.",
      inputSchema: z.object({
        processId: z.string(),
        force: z.boolean().default(false),
      }),
      outputSchema: processSnapshotSchema,
      annotations: destructiveLocalMutation,
    },
    mcpTool((input: { processId: string; force: boolean }) =>
      operations.run(
        {
          pluginId: "process",
          source: "mcp",
          action: input.force ? "kill" : "terminate",
          processId: input.processId,
          input,
        },
        () => Promise.resolve(processes.kill(input.processId, input.force)),
      ),
    ),
  );
}
