/**
 * Domain model for a persistent ChatRoom workspace.
 * Workspace identity is persistent and independent from transport connection lifetime.
 */
/** `checkout` uses sourceRoot directly; `worktree` uses a managed detached Git worktree. */
export type WorkspaceMode = "checkout" | "worktree";

interface WorkspaceCapabilities {
  filesystem: "read-write";
  git: boolean;
  skills: boolean;
}

export interface Workspace {
  id: string;
  root: string;
  sourceRoot: string;
  mode: WorkspaceMode;
  createdAt: string;
  lastUsedAt: string;
  instructions: string[];
  skills: string[];
  capabilities: WorkspaceCapabilities;
}
