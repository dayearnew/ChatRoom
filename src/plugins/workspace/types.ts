export interface WorkspaceEntry {
  root: string;
  name: string;
  summary: string | null;
}

export interface WorkspaceSkill {
  name: string;
  description: string;
  path: string;
}

export interface WorkspaceInfo {
  root: string;
  name: string;
  summary: string | null;
  presetPrompt: string | null;
  instructions: string | null;
  skills: WorkspaceSkill[];
}

export interface WorkspaceFile {
  path: string;
  type: "file" | "directory" | "symlink";
  size: number;
}
