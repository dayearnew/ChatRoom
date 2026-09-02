export interface WorkspaceEntry {
  root: string;
}

export interface WorkspaceSkill {
  name: string;
  description: string;
  path: string;
}

export interface WorkspaceInfo {
  root: string;
  instructions: string | null;
  skills: WorkspaceSkill[];
}

export interface WorkspaceFile {
  path: string;
  type: "file" | "directory" | "symlink";
  size: number;
}
