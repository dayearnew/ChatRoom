import type { McpServer } from "@modelcontextprotocol/server";
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
    for (const plugin of this.active) plugin.registerMcp?.(server);
  }

  async stop(): Promise<void> {
    for (const plugin of [...this.active].reverse())
      await plugin.deactivate?.();
    this.active.length = 0;
  }
}
