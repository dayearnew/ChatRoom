/**
 * Workspace-scoped filesystem implementation and the primary path-containment boundary for ChatRoom file tools.
 * It rejects absolute/traversal paths and prevents reads or writes that escape through symbolic links.
 */
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
import { randomUUID } from "node:crypto";
import { ChatRoomError } from "../../../core/errors/chatroom-error.js";
import type {
  ChangeSet,
  FileInfo,
  PatchReplacement,
  SearchMatch,
} from "../domain/filesystem.js";

export class WorkspaceFs {
  private constructor(
    readonly root: string,
    private readonly realRoot: string,
  ) {}

  static async create(root: string): Promise<WorkspaceFs> {
    const resolved = path.resolve(root);
    const canonical = await realpath(resolved).catch(() => {
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
    return new WorkspaceFs(resolved, canonical);
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
      const size = Math.min(info.size, maxBytes);
      const buffer = Buffer.alloc(size);
      const result = await handle.read(buffer, 0, size, 0);
      return {
        data: buffer.subarray(0, result.bytesRead),
        bytes: info.size,
        truncated: info.size > maxBytes,
      };
    } finally {
      await handle.close();
    }
  }

  async write(
    relativePath: string,
    content: string,
  ): Promise<{ path: string; bytes: number }> {
    const target = await this.resolveWritable(relativePath, true);
    let mode = 0o644;
    try {
      mode = (await lstat(target)).mode & 0o777;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    // Write beside the destination and rename atomically so readers never observe partially written content.
    const temp = `${target}.chatroom-${randomUUID()}.tmp`;
    await writeFile(temp, content, { flag: "wx", mode });
    try {
      await rename(temp, target);
    } finally {
      await rm(temp, { force: true }).catch(() => undefined);
    }
    return {
      path: this.normalizeRelative(relativePath),
      bytes: Buffer.byteLength(content),
    };
  }

  async list(
    relativePath = ".",
    options: { recursive?: boolean; maxEntries?: number } = {},
  ): Promise<FileInfo[]> {
    const start = await this.resolveReadable(relativePath);
    const maxEntries = Math.min(options.maxEntries ?? 1000, 10000);
    const output: FileInfo[] = [];
    const walk = async (absolute: string): Promise<void> => {
      for (const entry of await readdir(absolute, { withFileTypes: true })) {
        if (output.length >= maxEntries) return;
        const absoluteEntry = path.join(absolute, entry.name);
        const relative = path
          .relative(this.realRoot, absoluteEntry)
          .split(path.sep)
          .join("/");
        const info = await lstat(absoluteEntry);
        const type: FileInfo["type"] = info.isSymbolicLink()
          ? "symlink"
          : info.isDirectory()
            ? "directory"
            : "file";
        output.push({
          path: relative,
          type,
          size: info.size,
          modifiedAt: info.mtime.toISOString(),
        });
        // Never recurse through symlinks; their targets may point outside the workspace.
        if (options.recursive && entry.isDirectory() && !entry.isSymbolicLink())
          await walk(absoluteEntry);
      }
    };
    const startInfo = await stat(start);
    if (!startInfo.isDirectory())
      throw new ChatRoomError(
        "INVALID_INPUT",
        `Not a directory: ${relativePath}`,
      );
    await walk(start);
    return output;
  }

  async search(
    query: string,
    options: {
      path?: string;
      maxResults?: number;
    } = {},
  ): Promise<SearchMatch[]> {
    if (!query)
      throw new ChatRoomError(
        "INVALID_INPUT",
        "Search query must not be empty",
      );
    const maxResults = Math.min(options.maxResults ?? 200, 2000);
    const files = await this.list(options.path ?? ".", {
      recursive: true,
      maxEntries: 10000,
    });
    const needle = query.toLocaleLowerCase();
    const results: SearchMatch[] = [];
    for (const file of files) {
      if (
        results.length >= maxResults ||
        file.type !== "file" ||
        file.size > 2 * 1024 * 1024
      )
        continue;
      const data = await this.read(file.path, { maxBytes: 2 * 1024 * 1024 });
      if (data.content.includes("\0")) continue;
      const lines = data.content.split(/\r?\n/);
      for (
        let lineIndex = 0;
        lineIndex < lines.length && results.length < maxResults;
        lineIndex++
      ) {
        const line = lines[lineIndex] ?? "";
        const haystack = line.toLocaleLowerCase();
        const column = haystack.indexOf(needle);
        if (column !== -1)
          results.push({
            path: file.path,
            line: lineIndex + 1,
            column: column + 1,
            preview: line.slice(0, 500),
          });
      }
    }
    return results;
  }

  async patch(replacements: PatchReplacement[]): Promise<ChangeSet> {
    if (!replacements.length)
      throw new ChatRoomError(
        "INVALID_INPUT",
        "Patch must contain at least one replacement",
      );
    const grouped = new Map<string, PatchReplacement[]>();
    for (const replacement of replacements) {
      if (!replacement.oldText)
        throw new ChatRoomError(
          "INVALID_INPUT",
          `oldText must not be empty: ${replacement.path}`,
        );
      const key = this.normalizeRelative(replacement.path);
      grouped.set(key, [...(grouped.get(key) ?? []), replacement]);
    }

    // Phase 1 prepares every file completely before any destination is changed.
    const prepared: Array<{
      relative: string;
      target: string;
      after: string;
      temp: string;
      backup: string;
      mode: number;
    }> = [];
    let replacementCount = 0;
    let bytesBefore = 0;
    let bytesAfter = 0;
    for (const [relative, edits] of grouped) {
      const target = await this.resolveWritable(relative, false);
      const mode = (await lstat(target)).mode & 0o777;
      const before = (await this.read(relative, { maxBytes: 64 * 1024 * 1024 }))
        .content;
      let after = before;
      for (const edit of edits) {
        const occurrences = countOccurrences(after, edit.oldText);
        if (occurrences === 0)
          throw new ChatRoomError(
            "CONFLICT",
            `oldText not found in ${relative}`,
          );
        if (edit.occurrence === "all") {
          after = after.split(edit.oldText).join(edit.newText);
          replacementCount += occurrences;
        } else {
          const occurrence = edit.occurrence ?? 1;
          if (occurrence < 1 || occurrence > occurrences)
            throw new ChatRoomError(
              "CONFLICT",
              `Occurrence ${occurrence} not found in ${relative}`,
              { occurrences },
            );
          after = replaceOccurrence(
            after,
            edit.oldText,
            edit.newText,
            occurrence,
          );
          replacementCount += 1;
        }
      }
      bytesBefore += Buffer.byteLength(before);
      bytesAfter += Buffer.byteLength(after);
      const id = randomUUID();
      prepared.push({
        relative,
        target,
        after,
        temp: `${target}.chatroom-${id}.tmp`,
        backup: `${target}.chatroom-${id}.bak`,
        mode,
      });
    }

    try {
      for (const item of prepared)
        await writeFile(item.temp, item.after, { flag: "wx", mode: item.mode });
    } catch (error) {
      for (const item of prepared)
        await rm(item.temp, { force: true }).catch(() => undefined);
      throw error;
    }

    // Phase 2 commits with backups so already-swapped files can be restored if a later rename fails.
    const committed: typeof prepared = [];
    try {
      for (const item of prepared) {
        await rename(item.target, item.backup);
        try {
          await rename(item.temp, item.target);
          committed.push(item);
        } catch (error) {
          await rename(item.backup, item.target).catch(() => undefined);
          throw error;
        }
      }
    } catch (error) {
      for (const item of committed.reverse()) {
        await rm(item.target, { force: true }).catch(() => undefined);
        await rename(item.backup, item.target).catch(() => undefined);
      }
      throw new ChatRoomError(
        "INTERNAL",
        "Patch commit failed and was rolled back",
        undefined,
        {
          cause: error,
        },
      );
    } finally {
      for (const item of prepared) {
        await rm(item.temp, { force: true }).catch(() => undefined);
        await rm(item.backup, { force: true }).catch(() => undefined);
      }
    }
    return {
      files: prepared.map((item) => item.relative),
      replacements: replacementCount,
      bytesBefore,
      bytesAfter,
    };
  }

  private normalizeRelative(input: string): string {
    // Check both host-native and Windows path syntax so a path cannot become dangerous when moved across platforms.
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

  private lexical(relativePath: string): string {
    const normalized = this.normalizeRelative(relativePath);
    const absolute = path.resolve(this.realRoot, ...normalized.split("/"));
    if (!inside(this.realRoot, absolute))
      throw new ChatRoomError("FORBIDDEN", "Path escapes workspace");
    return absolute;
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
    // realpath resolves symlinks before containment is checked against the canonical workspace root.
    if (!inside(this.realRoot, canonical))
      throw new ChatRoomError("FORBIDDEN", "Symlink escapes workspace");
    return canonical;
  }

  private async resolveWritable(
    relativePath: string,
    createParents: boolean,
  ): Promise<string> {
    const target = this.lexical(relativePath);
    const relative = path.relative(this.realRoot, target);
    const parts = relative.split(path.sep).filter(Boolean);
    let current = this.realRoot;
    // Walk each existing parent explicitly so writes cannot traverse a symlinked directory.
    for (let index = 0; index < parts.length - 1; index++) {
      current = path.join(current, parts[index]!);
      try {
        const info = await lstat(current);
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
        if (!inside(this.realRoot, canonical))
          throw new ChatRoomError("FORBIDDEN", "Write path escapes workspace");
      } catch (error) {
        if (error instanceof ChatRoomError) throw error;
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        if (!createParents)
          throw new ChatRoomError(
            "NOT_FOUND",
            `Parent directory does not exist: ${relativePath}`,
          );
        await mkdir(current, { recursive: false, mode: 0o700 });
      }
    }
    try {
      const targetInfo = await lstat(target);
      if (targetInfo.isSymbolicLink())
        throw new ChatRoomError(
          "FORBIDDEN",
          `Writes through symlinks are not allowed: ${relativePath}`,
        );
    } catch (error) {
      if (error instanceof ChatRoomError) throw error;
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    return target;
  }
}

function inside(root: string, candidate: string): boolean {
  const rel = path.relative(root, candidate);
  return (
    rel === "" ||
    (!rel.startsWith(`..${path.sep}`) && rel !== ".." && !path.isAbsolute(rel))
  );
}
function countOccurrences(text: string, needle: string): number {
  let count = 0,
    index = 0;
  while ((index = text.indexOf(needle, index)) !== -1) {
    count++;
    index += needle.length;
  }
  return count;
}
function replaceOccurrence(
  text: string,
  needle: string,
  replacement: string,
  occurrence: number,
): string {
  let index = -1,
    from = 0;
  for (let i = 0; i < occurrence; i++) {
    index = text.indexOf(needle, from);
    from = index + needle.length;
  }
  return `${text.slice(0, index)}${replacement}${text.slice(index + needle.length)}`;
}
