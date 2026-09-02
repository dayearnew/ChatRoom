import { z } from "zod";
import type { PluginMcpRegistrar } from "../../mcp/server/plugin-mcp-registrar.js";
import { closedRead } from "../../mcp/server/tool-support.js";
import type { WorkspaceService } from "./workspace-service.js";

const workspaceInfoSchema = z.object({
  root: z.string(),
  instructions: z.string().nullable(),
  skills: z.array(
    z.object({
      name: z.string(),
      description: z.string(),
      path: z.string(),
    }),
  ),
});

export function registerWorkspaceTools(
  mcp: PluginMcpRegistrar,
  workspaces: WorkspaceService,
): void {
  mcp.registerTool(
    "workspace_info",
    {
      title: "Workspace info",
      description:
        "Read project instructions and skill metadata for a directory within the configured allowed roots.",
      inputSchema: z.object({ root: z.string() }),
      outputSchema: workspaceInfoSchema,
      annotations: closedRead,
      action: "info",
    },
    (input) => workspaces.info(input.root),
  );
}
