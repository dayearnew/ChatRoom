import { z } from "zod";
import type { PluginMcpRegistrar } from "../../mcp/server/plugin-mcp-registrar.js";
import {
  changeSetSchema,
  closedRead,
  destructiveLocalMutation,
  fileInfoSchema,
  fileReadOutputSchema,
  fileWriteOutputSchema,
  localMutation,
  localWrite,
  searchMatchSchema,
  workspaceOutputSchema,
} from "../../mcp/server/tool-support.js";
import type { WorkspaceService } from "./workspace-service.js";

export function registerWorkspaceTools(
  mcp: PluginMcpRegistrar,
  workspaces: WorkspaceService,
): void {
  mcp.registerTool(
    "open_workspace",
    {
      title: "Open workspace",
      description:
        "Open or reuse an approved checkout, or create a new isolated managed Git worktree from the source checkout HEAD.",
      inputSchema: z.object({
        path: z.string(),
        mode: z.enum(["checkout", "worktree"]).optional(),
      }),
      outputSchema: workspaceOutputSchema,
      annotations: localMutation,
      action: "open",
    },
    (input) =>
      workspaces.open({
        path: input.path,
        ...(input.mode ? { mode: input.mode } : {}),
      }),
  );

  mcp.registerTool(
    "remove_workspace",
    {
      title: "Remove workspace",
      description:
        "Unregister a checkout workspace or remove a managed worktree. Dirty worktrees require force=true.",
      inputSchema: z.object({
        workspaceId: z.string(),
        force: z.boolean().optional(),
      }),
      outputSchema: z.object({
        removed: z.boolean(),
        workspaceId: z.string(),
        mode: z.enum(["checkout", "worktree"]),
      }),
      annotations: destructiveLocalMutation,
      action: "remove",
    },
    async (input) => {
      const removed = await workspaces.remove(
        input.workspaceId,
        input.force ?? false,
      );
      return { removed: true, workspaceId: removed.id, mode: removed.mode };
    },
  );

  mcp.registerTool(
    "fs_read",
    {
      title: "Read file",
      description:
        "Read a workspace-relative file through the ChatRoom filesystem boundary.",
      inputSchema: z.object({
        workspaceId: z.string(),
        path: z.string(),
        maxBytes: z
          .number()
          .int()
          .positive()
          .max(16 * 1024 * 1024)
          .optional(),
      }),
      outputSchema: fileReadOutputSchema,
      annotations: closedRead,
      action: "fs.read",
    },
    async (input) => {
      const fs = await workspaces.fs(input.workspaceId);
      return fs.read(
        input.path,
        input.maxBytes === undefined ? {} : { maxBytes: input.maxBytes },
      );
    },
  );

  mcp.registerTool(
    "fs_write",
    {
      title: "Write file",
      description: "Atomically write a workspace-relative file.",
      inputSchema: z.object({
        workspaceId: z.string(),
        path: z.string(),
        content: z.string(),
      }),
      outputSchema: fileWriteOutputSchema,
      annotations: localWrite,
      action: "fs.write",
    },
    async (input) => {
      const fs = await workspaces.fs(input.workspaceId);
      return fs.write(input.path, input.content);
    },
  );

  mcp.registerTool(
    "fs_list",
    {
      title: "List files",
      description: "List files under a workspace-relative directory.",
      inputSchema: z.object({
        workspaceId: z.string(),
        path: z.string().default("."),
        recursive: z.boolean().default(false),
      }),
      outputSchema: z.object({ files: z.array(fileInfoSchema) }),
      annotations: closedRead,
      action: "fs.list",
    },
    async (input) => {
      const fs = await workspaces.fs(input.workspaceId);
      return {
        files: await fs.list(input.path, { recursive: input.recursive }),
      };
    },
  );

  mcp.registerTool(
    "fs_search",
    {
      title: "Search files",
      description: "Search text under a workspace.",
      inputSchema: z.object({
        workspaceId: z.string(),
        query: z.string().min(1),
        path: z.string().default("."),
        maxResults: z.number().int().positive().max(2000).default(200),
      }),
      outputSchema: z.object({ matches: z.array(searchMatchSchema) }),
      annotations: closedRead,
      action: "fs.search",
    },
    async (input) => {
      const fs = await workspaces.fs(input.workspaceId);
      return {
        matches: await fs.search(input.query, {
          path: input.path,
          maxResults: input.maxResults,
        }),
      };
    },
  );

  mcp.registerTool(
    "fs_patch",
    {
      title: "Transactional patch",
      description:
        "Validate all replacements before committing a multi-file text patch.",
      inputSchema: z.object({
        workspaceId: z.string(),
        replacements: z
          .array(
            z.object({
              path: z.string(),
              oldText: z.string().min(1),
              newText: z.string(),
              occurrence: z
                .union([z.number().int().positive(), z.literal("all")])
                .optional(),
            }),
          )
          .min(1),
      }),
      outputSchema: changeSetSchema,
      annotations: destructiveLocalMutation,
      action: "fs.patch",
    },
    async (input) => {
      const fs = await workspaces.fs(input.workspaceId);
      return fs.patch(
        input.replacements.map((item) => ({
          path: item.path,
          oldText: item.oldText,
          newText: item.newText,
          ...(item.occurrence === undefined
            ? {}
            : { occurrence: item.occurrence }),
        })),
      );
    },
  );
}
