import { lstat, open, readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { ChatRoomError } from "../../core/errors/chatroom-error.js";
import type { WorkspaceFile } from "./types.js";

export class WorkspaceFs {
  private constructor(readonly root: string) {}

  static async create(root: string): Promise<WorkspaceFs> {
    const canonical = await realpath(path.resolve(root)).catch(() => {
      throw new ChatRoomError(
        "NOT_FOUND",
        `Workspace root does not exist: ${root}`,
      );
    });
    const info = await stat(canonical);
    if (!info.isDirectory())
      throw new ChatRoomError(
        "INVALID_INPUT",
        `Workspace root is not a directory: ${root}`,
      );
    return new WorkspaceFs(canonical);
  }

  async read(
    relativePath: string,
    options: { maxBytes?: number } = {},
  ): Promise<{ content: string; bytes: number; truncated: boolean }> {
    const result = await this.readBytes(relativePath, options);
    return {
      content: result.data.toString("utf8"),
      bytes: result.bytes,
      truncated: result.truncated,
    };
  }

  async readBytes(
    relativePath: string,
    options: { maxBytes?: number } = {},
  ): Promise<{ data: Buffer; bytes: number; truncated: boolean }> {
    const target = await this.resolveReadable(relativePath);
    const info = await stat(target);
    if (!info.isFile())
      throw new ChatRoomError("INVALID_INPUT", `Not a file: ${relativePath}`);
    const maxBytes = options.maxBytes ?? 1024 * 1024;
    const handle = await open(target, "r");
    try {
      const readSize = Math.min(info.size, maxBytes);
      const buffer = Buffer.alloc(readSize);
      const result = await handle.read(buffer, 0, readSize, 0);
      return {
        data: buffer.subarray(0, result.bytesRead),
        bytes: info.size,
        truncated: info.size > maxBytes,
      };
    } finally {
      await handle.close();
    }
  }

  async list(
    relativePath = ".",
    options: { recursive?: boolean; maxEntries?: number } = {},
  ): Promise<WorkspaceFile[]> {
    const start = await this.resolveReadable(relativePath);
    if (!(await stat(start)).isDirectory())
      throw new ChatRoomError(
        "INVALID_INPUT",
        `Not a directory: ${relativePath}`,
      );

    const maxEntries = Math.min(options.maxEntries ?? 1000, 10000);
    const output: WorkspaceFile[] = [];
    const walk = async (directory: string): Promise<void> => {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        if (output.length >= maxEntries) return;
        const absolute = path.join(directory, entry.name);
        const info = await lstat(absolute);
        const type: WorkspaceFile["type"] = info.isSymbolicLink()
          ? "symlink"
          : info.isDirectory()
            ? "directory"
            : "file";
        output.push({
          path: path.relative(this.root, absolute).split(path.sep).join("/"),
          type,
          size: info.size,
        });
        if (options.recursive && entry.isDirectory() && !entry.isSymbolicLink())
          await walk(absolute);
      }
    };
    await walk(start);
    return output;
  }

  private async resolveReadable(relativePath: string): Promise<string> {
    const normalized = normalizeRelative(relativePath);
    const lexical = path.resolve(this.root, ...normalized.split("/"));
    if (!inside(this.root, lexical))
      throw new ChatRoomError("FORBIDDEN", "Path escapes workspace");
    const canonical = await realpath(lexical).catch((error) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        throw new ChatRoomError(
          "NOT_FOUND",
          `Path does not exist: ${relativePath}`,
        );
      throw error;
    });
    if (!inside(this.root, canonical))
      throw new ChatRoomError("FORBIDDEN", "Symlink escapes workspace");
    return canonical;
  }
}

function normalizeRelative(input: string): string {
  if (typeof input !== "string" || input.includes("\0"))
    throw new ChatRoomError("INVALID_INPUT", "Path must be a valid string");
  if (
    path.isAbsolute(input) ||
    path.win32.isAbsolute(input) ||
    /^\\\\/.test(input)
  )
    throw new ChatRoomError("FORBIDDEN", "Absolute paths are not allowed");
  const parts = input
    .split(/[\\/]+/)
    .filter((part) => part !== "" && part !== ".");
  if (parts.some((part) => part === ".."))
    throw new ChatRoomError("FORBIDDEN", "Path traversal is not allowed");
  return parts.join("/") || ".";
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
