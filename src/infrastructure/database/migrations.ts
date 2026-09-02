import type { DatabaseSync } from "node:sqlite";
import { DATABASE_SCHEMA_VERSION } from "./schema.js";

export function migrateDatabase(db: DatabaseSync): void {
  let version = userVersion(db);
  if (version > DATABASE_SCHEMA_VERSION)
    throw new Error(
      `Database schema ${version} is newer than this ChatRoom build (${DATABASE_SCHEMA_VERSION})`,
    );

  while (version < DATABASE_SCHEMA_VERSION) {
    switch (version) {
      case 0:
        migrate0To1(db);
        version = 1;
        break;
      default:
        throw new Error(`Unsupported ChatRoom database schema: ${version}`);
    }
  }
}

function migrate0To1(db: DatabaseSync): void {
  db.exec("BEGIN IMMEDIATE;");
  try {
    db.exec(`
      DROP TABLE IF EXISTS workspaces;
      DROP TABLE IF EXISTS audit_events;
      DROP TABLE IF EXISTS agent_runs;
      DROP INDEX IF EXISTS operations_workspace_idx;
    `);

    const operationColumns = db
      .prepare("PRAGMA table_info(operations)")
      .all() as unknown as Array<{ name: string }>;
    if (operationColumns.some((column) => column.name === "workspace_id"))
      db.exec("ALTER TABLE operations DROP COLUMN workspace_id;");

    db.exec("PRAGMA user_version = 1; COMMIT;");
  } catch (error) {
    db.exec("ROLLBACK;");
    throw error;
  }
}

function userVersion(db: DatabaseSync): number {
  const row = db.prepare("PRAGMA user_version").get() as
    { user_version?: unknown } | undefined;
  const version = Number(row?.user_version ?? 0);
  if (!Number.isInteger(version) || version < 0)
    throw new Error(`Invalid ChatRoom database schema version: ${version}`);
  return version;
}
