import { randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  open,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
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

  async write(relativePath: string, content: string): Promise<WorkspaceFile> {
    if (typeof content !== "string")
      throw new ChatRoomError("INVALID_INPUT", "File content must be a string");

    const normalized = normalizeRelative(relativePath);
    if (normalized === ".")
      throw new ChatRoomError("INVALID_INPUT", "File path is required");

    const target = await this.resolveWritable(normalized);
    let mode = 0o644;
    try {
      const info = await lstat(target);
      if (!info.isFile())
        throw new ChatRoomError("INVALID_INPUT", `Not a file: ${relativePath}`);
      mode = info.mode & 0o777;
    } catch (error) {
      if (error instanceof ChatRoomError) throw error;
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }

    const temporary = `${target}.chatroom-${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, content, {
        encoding: "utf8",
        flag: "wx",
        mode,
      });
      await rename(temporary, target);
    } finally {
      await rm(temporary, { force: true }).catch(() => undefined);
    }

    return {
      path: normalized,
      type: "file",
      size: Buffer.byteLength(content, "utf8"),
    };
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

  private lexical(relativePath: string): string {
    const normalized = normalizeRelative(relativePath);
    const absolute = path.resolve(this.root, ...normalized.split("/"));
    if (!inside(this.root, absolute))
      throw new ChatRoomError("FORBIDDEN", "Path escapes workspace");
    return absolute;
  }

  private async resolveWritable(relativePath: string): Promise<string> {
    const target = this.lexical(relativePath);
    const relative = path.relative(this.root, target);
    const parts = relative.split(path.sep).filter(Boolean);
    let current = this.root;

    for (let index = 0; index < parts.length - 1; index++) {
      current = path.join(current, parts[index]!);
      let info;
      try {
        info = await lstat(current);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        try {
          await mkdir(current, { recursive: false, mode: 0o700 });
        } catch (mkdirError) {
          if ((mkdirError as NodeJS.ErrnoException).code !== "EEXIST")
            throw mkdirError;
        }
        info = await lstat(current);
      }

      if (info.isSymbolicLink())
        throw new ChatRoomError(
          "FORBIDDEN",
          `Writes through symlinked directories are not allowed: ${relativePath}`,
        );
      if (!info.isDirectory())
        throw new ChatRoomError(
          "INVALID_INPUT",
          `Parent is not a directory: ${parts[index]}`,
        );
      const canonical = await realpath(current);
      if (!inside(this.root, canonical))
        throw new ChatRoomError("FORBIDDEN", "Write path escapes workspace");
    }

    try {
      const targetInfo = await lstat(target);
      if (targetInfo.isSymbolicLink())
        throw new ChatRoomError(
          "FORBIDDEN",
          `Writes through symlinks are not allowed: ${relativePath}`,
        );
      if (!targetInfo.isFile())
        throw new ChatRoomError("INVALID_INPUT", `Not a file: ${relativePath}`);
    } catch (error) {
      if (error instanceof ChatRoomError) throw error;
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    return target;
  }

  private async resolveReadable(relativePath: string): Promise<string> {
    const lexical = this.lexical(relativePath);
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
