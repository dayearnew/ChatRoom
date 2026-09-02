import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { migrateDatabase } from "./migrations.js";
import { DATABASE_SCHEMA } from "./schema.js";

export class AppDatabase {
  readonly raw: DatabaseSync;

  constructor(databasePath: string) {
    mkdirSync(path.dirname(databasePath), { recursive: true, mode: 0o700 });
    this.raw = new DatabaseSync(databasePath);
    this.raw.exec(
      "PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;",
    );
    migrateDatabase(this.raw);
    this.raw.exec(DATABASE_SCHEMA);
  }

  close(): void {
    this.raw.close();
  }
}
