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
    for (const plugin of this.plugins) {
      await plugin.activate(this.context);
      this.active.push(plugin);
    }
  }

  registerMcp(server: McpServer): void {
    for (const plugin of this.active) {
      if (!plugin.registerMcp) continue;
      plugin.registerMcp(
        new PluginMcpRegistrar(server, this.context.operations, plugin.id),
      );
    }
  }

  async stop(): Promise<void> {
    for (const plugin of [...this.active].reverse())
      await plugin.deactivate?.();
    this.active.length = 0;
  }
}
