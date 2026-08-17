import type { WorkspaceMode } from "./workspace.js";

export interface WorkspaceRecord {
  id: string;
  root: string;
  sourceRoot: string;
  mode: WorkspaceMode;
  createdAt: string;
  lastUsedAt: string;
}

export interface WorkspaceStateRepository {
  upsert(workspace: WorkspaceRecord): void;
  get(workspaceId: string): WorkspaceRecord | null;
  findByRoot(root: string, mode: WorkspaceMode): WorkspaceRecord | null;
  list(): WorkspaceRecord[];
  remove(workspaceId: string): void;
}
