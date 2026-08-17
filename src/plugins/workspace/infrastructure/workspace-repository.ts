import type {
  WorkspaceRecord,
  WorkspaceStateRepository,
} from "../domain/repository.js";
import type { WorkspaceMode } from "../domain/workspace.js";
import type { AppDatabase } from "../../../infrastructure/database/app-database.js";

export class WorkspaceRepository implements WorkspaceStateRepository {
  constructor(private readonly database: AppDatabase) {}

  upsert(workspace: WorkspaceRecord): void {
    this.database.raw
      .prepare(
        `
          INSERT INTO workspaces(id,root,source_root,mode,created_at,last_used_at)
          VALUES(?,?,?,?,?,?)
          ON CONFLICT(id) DO UPDATE SET
            root=excluded.root,
            source_root=excluded.source_root,
            mode=excluded.mode,
            last_used_at=excluded.last_used_at
        `,
      )
      .run(
        workspace.id,
        workspace.root,
        workspace.sourceRoot,
        workspace.mode,
        workspace.createdAt,
        workspace.lastUsedAt,
      );
  }

  get(workspaceId: string): WorkspaceRecord | null {
    const row = this.database.raw
      .prepare("SELECT * FROM workspaces WHERE id=?")
      .get(workspaceId) as WorkspaceRow | undefined;
    return row ? fromRow(row) : null;
  }

  findByRoot(root: string, mode: WorkspaceMode): WorkspaceRecord | null {
    const row = this.database.raw
      .prepare("SELECT * FROM workspaces WHERE root=? AND mode=?")
      .get(root, mode) as WorkspaceRow | undefined;
    return row ? fromRow(row) : null;
  }

  list(): WorkspaceRecord[] {
    return (
      this.database.raw
        .prepare("SELECT * FROM workspaces ORDER BY last_used_at DESC")
        .all() as unknown as WorkspaceRow[]
    ).map(fromRow);
  }

  remove(workspaceId: string): void {
    this.database.raw
      .prepare("DELETE FROM workspaces WHERE id=?")
      .run(workspaceId);
  }
}

interface WorkspaceRow {
  id: string;
  root: string;
  source_root: string;
  mode: WorkspaceMode;
  created_at: string;
  last_used_at: string;
}

function fromRow(row: WorkspaceRow): WorkspaceRecord {
  return {
    id: row.id,
    root: row.root,
    sourceRoot: row.source_root,
    mode: row.mode,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
  };
}
