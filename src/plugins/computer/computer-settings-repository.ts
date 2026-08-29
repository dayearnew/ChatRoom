import type { AppDatabase } from "../../infrastructure/database/app-database.js";
import type { ComputerSettings } from "./types.js";

export class ComputerSettingsRepository {
  constructor(private readonly database: AppDatabase) {}

  get(): ComputerSettings {
    const row = this.database.raw
      .prepare(
        "SELECT enabled, remote_access, updated_at FROM computer_settings WHERE id = 1",
      )
      .get() as Record<string, unknown> | undefined;
    if (row) return fromRow(row);
    const value: ComputerSettings = {
      enabled: false,
      remoteAccess: true,
      updatedAt: new Date().toISOString(),
    };
    this.set(value);
    return value;
  }

  set(
    value: Omit<ComputerSettings, "updatedAt"> | ComputerSettings,
  ): ComputerSettings {
    const updatedAt = new Date().toISOString();
    this.database.raw
      .prepare(
        `
      INSERT INTO computer_settings(id, enabled, remote_access, updated_at)
      VALUES(1, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        enabled = excluded.enabled,
        remote_access = excluded.remote_access,
        updated_at = excluded.updated_at
    `,
      )
      .run(value.enabled ? 1 : 0, value.remoteAccess ? 1 : 0, updatedAt);
    return { ...value, updatedAt };
  }
}

function fromRow(row: Record<string, unknown>): ComputerSettings {
  return {
    enabled: Boolean(row.enabled),
    remoteAccess: Boolean(row.remote_access),
    updatedAt: String(row.updated_at),
  };
}
