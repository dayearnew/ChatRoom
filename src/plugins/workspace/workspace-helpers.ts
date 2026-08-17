import { access } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ChatRoomError } from "../../core/errors/chatroom-error.js";
import type { WorkspaceFs } from "./infrastructure/workspace-fs.js";
import type { WorkspaceRecord } from "./domain/repository.js";
import type { Workspace } from "./domain/workspace.js";

export async function discoverInstructions(fs: WorkspaceFs): Promise<string[]> {
  try {
    const file = await fs.read("AGENTS.md", { maxBytes: 64 * 1024 });
    return [`AGENTS.md\n${file.content}`];
  } catch (error) {
    if (error instanceof ChatRoomError && error.code === "NOT_FOUND") return [];
    throw error;
  }
}

export async function discoverSkills(fs: WorkspaceFs): Promise<string[]> {
  const output: string[] = [];
  for (const root of [".agents/skills", ".chatroom/skills"]) {
    try {
      const entries = await fs.list(root, {
        recursive: true,
        maxEntries: 2000,
      });
      for (const entry of entries)
        if (entry.type === "file" && entry.path.endsWith("/SKILL.md"))
          output.push(entry.path);
    } catch (error) {
      if (!(error instanceof ChatRoomError) || error.code !== "NOT_FOUND")
        throw error;
    }
  }
  return [...new Set(output)].sort();
}

export function expandHome(input: string): string {
  if (input === "~") return os.homedir();
  if (input.startsWith("~/") || input.startsWith("~\\"))
    return path.join(os.homedir(), input.slice(2));
  return path.resolve(input);
}

export function inside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
}

export async function exists(target: string): Promise<boolean> {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

export function toRecord(workspace: Workspace): WorkspaceRecord {
  return {
    id: workspace.id,
    root: workspace.root,
    sourceRoot: workspace.sourceRoot,
    mode: workspace.mode,
    createdAt: workspace.createdAt,
    lastUsedAt: workspace.lastUsedAt,
  };
}
