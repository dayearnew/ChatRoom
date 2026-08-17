/** Workspace filesystem value types. */
export interface FileInfo {
  path: string;
  type: "file" | "directory" | "symlink";
  size: number;
  modifiedAt: string;
}

export interface SearchMatch {
  path: string;
  line: number;
  column: number;
  preview: string;
}

export interface PatchReplacement {
  path: string;
  oldText: string;
  newText: string;
  occurrence?: number | "all";
}

export interface ChangeSet {
  files: string[];
  replacements: number;
  bytesBefore: number;
  bytesAfter: number;
}
