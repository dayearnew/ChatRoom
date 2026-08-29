import type {
  McpServer,
  StandardSchemaWithJSON,
  ToolAnnotations,
  ToolCallback,
  CallToolResult,
} from "@modelcontextprotocol/server";
import { asChatRoomError } from "../../core/errors/chatroom-error.js";
import type { OperationLog } from "../../operations/operation-log.js";
import { mcpTool } from "./tool-support.js";

type PluginToolInput<Schema extends StandardSchemaWithJSON> =
  StandardSchemaWithJSON.InferOutput<Schema>;
type PluginToolAction<Input> = string | ((input: Input) => string);

export interface PluginToolExecution {
  readonly operationId: string;
  /** Keep the operation running after the MCP handler returns. The owner must finish it later. */
  deferCompletion(): void;
}

export interface PluginToolConfig<
  InputSchema extends StandardSchemaWithJSON,
  OutputSchema extends StandardSchemaWithJSON,
> {
  title: string;
  description: string;
  inputSchema: InputSchema;
  outputSchema: OutputSchema;
  annotations: ToolAnnotations;
  action: PluginToolAction<PluginToolInput<InputSchema>>;
  audit?: {
    input?: (input: PluginToolInput<InputSchema>) => unknown;
    output?: (output: unknown) => unknown;
  };
  present?: (output: unknown) => CallToolResult;
}

/** Framework-owned MCP registration boundary that guarantees every plugin tool is audited. */
export class PluginMcpRegistrar {
  constructor(
    private readonly server: McpServer,
    private readonly operations: OperationLog,
    private readonly pluginId: string,
  ) {}

  registerTool<
    InputSchema extends StandardSchemaWithJSON,
    OutputSchema extends StandardSchemaWithJSON,
  >(
    name: string,
    config: PluginToolConfig<InputSchema, OutputSchema>,
    handler: (
      input: PluginToolInput<InputSchema>,
      execution: PluginToolExecution,
    ) => Promise<unknown> | unknown,
  ): void {
    const { action, audit, present, ...toolConfig } = config;
    const callback = mcpTool<PluginToolInput<InputSchema>>(async (input) => {
      const operation = this.operations.start({
        pluginId: this.pluginId,
        source: "mcp",
        action: typeof action === "function" ? action(input) : action,
        input: audit?.input ? audit.input(input) : input,
        ...operationReferences(input),
      });
      let deferred = false;
      const execution: PluginToolExecution = {
        operationId: operation.operationId,
        deferCompletion() {
          deferred = true;
        },
      };
      try {
        const result = await handler(input, execution);
        if (!deferred)
          this.operations.finish(
            operation.operationId,
            "success",
            audit?.output ? audit.output(result) : result,
          );
        return result;
      } catch (error) {
        if (this.operations.get(operation.operationId)?.status === "running") {
          const normalized = asChatRoomError(error);
          this.operations.finish(operation.operationId, "error", null, {
            code: normalized.code,
            message: normalized.message,
            details: normalized.details,
          });
        }
        throw error;
      }
    }, present) as ToolCallback<InputSchema>;
    this.server.registerTool(name, toolConfig, callback);
  }
}

function operationReferences(input: unknown): {
  workspaceId?: string;
  processId?: string;
} {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const record = input as Record<string, unknown>;
  return {
    ...(typeof record.workspaceId === "string"
      ? { workspaceId: record.workspaceId }
      : {}),
    ...(typeof record.processId === "string"
      ? { processId: record.processId }
      : {}),
  };
}
