export type GitChangeKind =
  | "modified"
  | "added"
  | "deleted"
  | "renamed"
  | "copied"
  | "untracked"
  | "conflicted";

export interface GitChange {
  path: string;
  originalPath: string | null;
  indexStatus: string;
  workingTreeStatus: string;
  kind: GitChangeKind;
}

export interface GitStatus {
  branch: string | null;
  head: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
  changes: GitChange[];
}

export interface GitDiff {
  diff: string;
  truncated: boolean;
}

export interface GitBranch {
  name: string;
  current: boolean;
  upstream: string | null;
}

export interface GitCommit {
  hash: string;
  shortHash: string;
  author: string;
  date: string;
  subject: string;
}
