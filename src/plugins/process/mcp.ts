import { z } from "zod";
import type { PluginMcpRegistrar } from "../../mcp/server/plugin-mcp-registrar.js";
import {
  closedRead,
  destructiveLocalMutation,
  openWorldMutation,
  processSnapshotSchema,
} from "../../mcp/server/tool-support.js";
import type { ProcessSupervisor } from "./process-supervisor.js";

export function registerProcessTools(
  mcp: PluginMcpRegistrar,
  processes: ProcessSupervisor,
): void {
  mcp.registerTool(
    "process_start",
    {
      title: "Start process",
      description:
        "Start a supervised executable directly and return a ProcessId immediately. Prefer invoking the target executable without a shell. For compound shell commands, use bash -c rather than bash -lc unless login-shell semantics are explicitly required, because a login shell may replace the inherited PATH (for example, removing NVM-managed Node.js commands).",
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
      action: "start",
    },
    (input, execution) => {
      execution.deferCompletion();
      return processes.start(
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
        { source: "mcp", operationId: execution.operationId },
      );
    },
  );

  mcp.registerTool(
    "process_read",
    {
      title: "Read process",
      description: "Read bounded stdout/stderr and current process state.",
      inputSchema: z.object({ processId: z.string() }),
      outputSchema: processSnapshotSchema,
      annotations: closedRead,
      action: "read",
    },
    (input) => processes.read(input.processId),
  );

  mcp.registerTool(
    "process_write",
    {
      title: "Write process stdin",
      description: "Write to stdin of a running process.",
      inputSchema: z.object({ processId: z.string(), data: z.string() }),
      outputSchema: processSnapshotSchema,
      annotations: openWorldMutation,
      action: "write",
    },
    (input) => processes.write(input.processId, input.data),
  );

  mcp.registerTool(
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
      action: (input) => (input.force ? "kill" : "terminate"),
    },
    (input) => processes.kill(input.processId, input.force),
  );
}
