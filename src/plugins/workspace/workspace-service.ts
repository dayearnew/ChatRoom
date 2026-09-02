import { readdir, realpath, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ChatRoomError } from "../../core/errors/chatroom-error.js";
import { readInstructions, readSkills } from "./metadata.js";
import type { WorkspaceEntry, WorkspaceInfo } from "./types.js";
import { WorkspaceFs } from "./workspace-fs.js";

export class WorkspaceService {
  private constructor(private readonly allowedRoots: string[]) {}

  static async create(allowedRoots: string[]): Promise<WorkspaceService> {
    const canonicalRoots = await Promise.all(
      allowedRoots.map(async (root) => {
        const canonical = await realpath(expandHome(root)).catch(() => {
          throw new ChatRoomError(
            "NOT_FOUND",
            `Allowed root does not exist: ${root}`,
          );
        });
        if (!(await stat(canonical)).isDirectory())
          throw new ChatRoomError(
            "INVALID_INPUT",
            `Allowed root is not a directory: ${root}`,
          );
        return canonical;
      }),
    );
    return new WorkspaceService([...new Set(canonicalRoots)]);
  }

  async list(): Promise<WorkspaceEntry[]> {
    const roots = new Set<string>();
    for (const allowedRoot of this.allowedRoots) {
      let entries;
      try {
        entries = await readdir(allowedRoot, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (
          !entry.isDirectory() ||
          entry.isSymbolicLink() ||
          entry.name.startsWith(".")
        )
          continue;
        const candidate = await realpath(
          path.join(allowedRoot, entry.name),
        ).catch(() => null);
        if (candidate && inside(allowedRoot, candidate)) roots.add(candidate);
      }
    }
    return [...roots]
      .sort((a, b) => a.localeCompare(b))
      .map((root) => ({ root }));
  }

  async resolve(input: string): Promise<string> {
    if (typeof input !== "string" || !input.trim())
      throw new ChatRoomError("INVALID_INPUT", "Workspace root is required");
    const canonical = await realpath(expandHome(input)).catch(() => {
      throw new ChatRoomError(
        "NOT_FOUND",
        `Workspace root does not exist: ${input}`,
      );
    });
    if (!(await stat(canonical)).isDirectory())
      throw new ChatRoomError(
        "INVALID_INPUT",
        `Workspace root is not a directory: ${input}`,
      );
    if (!this.allowedRoots.some((root) => inside(root, canonical)))
      throw new ChatRoomError(
        "FORBIDDEN",
        "Workspace is outside configured allowedRoots",
        { root: canonical },
      );
    return canonical;
  }

  async info(input: string): Promise<WorkspaceInfo> {
    const root = await this.resolve(input);
    const fs = await WorkspaceFs.create(root);
    const [instructions, skills] = await Promise.all([
      readInstructions(fs),
      readSkills(fs),
    ]);
    return { root, instructions, skills };
  }

  async fs(input: string): Promise<WorkspaceFs> {
    return WorkspaceFs.create(await this.resolve(input));
  }
}

function expandHome(input: string): string {
  if (input === "~") return os.homedir();
  if (input.startsWith("~/") || input.startsWith("~\\"))
    return path.join(os.homedir(), input.slice(2));
  return path.resolve(input);
}

function inside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
}
