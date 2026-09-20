import type { McpToolSettingStore } from "#mcp/server/tool-control";
import type { AppDatabase } from "./app-database.js";

export class McpToolSettingsRepository implements McpToolSettingStore {
  constructor(private readonly database: AppDatabase) {}

  disabledTools(): string[] {
    return (
      this.database.raw
        .prepare("SELECT tool_name FROM mcp_tool_settings WHERE enabled=0")
        .all() as unknown as Array<{ tool_name: string }>
    ).map((row) => row.tool_name);
  }

  setEnabled(name: string, enabled: boolean): void {
    this.database.raw
      .prepare(
        `
        INSERT INTO mcp_tool_settings(tool_name, enabled, updated_at)
        VALUES(?,?,?)
        ON CONFLICT(tool_name) DO UPDATE SET
          enabled=excluded.enabled,
          updated_at=excluded.updated_at
      `,
      )
      .run(name, enabled ? 1 : 0, new Date().toISOString());
  }
}
