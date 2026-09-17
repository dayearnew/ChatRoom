import type { McpServer } from "@modelcontextprotocol/server";
import { PluginMcpRegistrar } from "../mcp/server/plugin-mcp-registrar.js";
import type { InternalPlugin, PluginContext } from "./types.js";

export class PluginManager {
  private readonly active: InternalPlugin[] = [];

  constructor(
    private readonly context: PluginContext,
    private readonly plugins: InternalPlugin[],
  ) {}

  async start(): Promise<void> {
    try {
      for (const plugin of this.plugins) {
        this.active.push(plugin);
        await plugin.activate(this.context);
      }
      for (const plugin of this.active) {
        if (!plugin.registerMcp) continue;
        plugin.registerMcp(
          new PluginMcpRegistrar(
            null,
            this.context.operations,
            plugin.id,
            this.context.mcpTools,
          ),
        );
      }
    } catch (error) {
      try {
        await this.stop();
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          "Plugin startup failed and rollback encountered errors",
        );
      }
      throw error;
    }
  }

  registerMcp(server: McpServer): void {
    for (const plugin of this.active) {
      if (!plugin.registerMcp) continue;
      plugin.registerMcp(
        new PluginMcpRegistrar(
          server,
          this.context.operations,
          plugin.id,
          this.context.mcpTools,
        ),
      );
    }
  }

  async stop(): Promise<void> {
    const errors: unknown[] = [];
    for (const plugin of [...this.active].reverse()) {
      try {
        await plugin.deactivate?.();
      } catch (error) {
        errors.push(error);
      }
    }
    this.active.length = 0;
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1)
      throw new AggregateError(errors, "Multiple plugins failed to stop");
  }
}
