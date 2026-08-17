type WorktreeFileStatus = "added" | "modified" | "deleted" | "type-changed";

export interface WorktreeReviewFile {
  path: string;
  status: WorktreeFileStatus;
  additions: number | null;
  deletions: number | null;
  binary: boolean;
}

export interface WorktreeApplyPreview {
  files: Array<WorktreeReviewFile & { applied: boolean; conflict: boolean }>;
  totalFiles: number;
  pendingFiles: number;
  appliedFiles: number;
  mergeableFiles: number;
  conflictFiles: number;
  canApply: boolean;
  reason: "no-changes" | "merge-conflicts" | "head-mismatch" | null;
}

export interface WorktreeFileDiff {
  path: string;
  diff: string;
  bytes: number;
  truncated: boolean;
}
