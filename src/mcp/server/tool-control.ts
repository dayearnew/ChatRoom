import type { RegisteredTool } from "@modelcontextprotocol/server";
import { ChatRoomError } from "../../core/errors/chatroom-error.js";

export interface McpToolSettingStore {
  disabledTools(): string[];
  setEnabled(name: string, enabled: boolean): void;
}

export interface McpToolSummary {
  name: string;
  pluginId: string;
  title: string;
  description: string;
  enabled: boolean;
}

interface McpToolDefinition {
  name: string;
  pluginId: string;
  title: string;
  description: string;
}

export class McpToolControl {
  private readonly disabled = new Set<string>();
  private readonly definitions = new Map<string, McpToolDefinition>();
  private readonly handles = new Map<string, Set<WeakRef<RegisteredTool>>>();

  constructor(private readonly store: McpToolSettingStore) {
    for (const name of store.disabledTools()) this.disabled.add(name);
  }

  define(definition: McpToolDefinition): void {
    const existing = this.definitions.get(definition.name);
    if (existing && existing.pluginId !== definition.pluginId)
      throw new Error(
        `MCP tool already belongs to another plugin: ${definition.name}`,
      );
    this.definitions.set(definition.name, definition);
  }

  attach(name: string, tool: RegisteredTool): void {
    let tools = this.handles.get(name);
    if (!tools) {
      tools = new Set();
      this.handles.set(name, tools);
    }
    tools.add(new WeakRef(tool));
    if (this.disabled.has(name)) tool.disable();
  }

  list(): McpToolSummary[] {
    return [...this.definitions.values()]
      .map((definition) => ({
        ...definition,
        enabled: !this.disabled.has(definition.name),
      }))
      .sort(
        (left, right) =>
          left.pluginId.localeCompare(right.pluginId) ||
          left.name.localeCompare(right.name),
      );
  }

  setEnabled(name: string, enabled: boolean): McpToolSummary {
    const definition = this.definitions.get(name);
    if (!definition)
      throw new ChatRoomError("NOT_FOUND", `Unknown MCP tool: ${name}`);

    if (enabled === !this.disabled.has(name)) return { ...definition, enabled };

    this.store.setEnabled(name, enabled);
    if (enabled) this.disabled.delete(name);
    else this.disabled.add(name);
    this.updateHandles(name, enabled);

    return { ...definition, enabled };
  }

  private updateHandles(name: string, enabled: boolean): void {
    const handles = this.handles.get(name);
    if (!handles) return;
    for (const reference of [...handles]) {
      const tool = reference.deref();
      if (!tool) {
        handles.delete(reference);
        continue;
      }
      if (tool.enabled === enabled) continue;
      if (enabled) tool.enable();
      else tool.disable();
    }
    if (!handles.size) this.handles.delete(name);
  }
}
