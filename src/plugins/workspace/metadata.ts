import path from "node:path";
import { ChatRoomError } from "../../core/errors/chatroom-error.js";
import type { WorkspaceFs } from "./workspace-fs.js";
import type { WorkspaceSkill } from "./types.js";

const SKILL_ROOTS = [".agents/skills", ".claude/skills", ".chatroom/skills"];
const MAX_METADATA_BYTES = 64 * 1024;

export async function readInstructions(
  fs: WorkspaceFs,
): Promise<string | null> {
  try {
    return (await fs.read("AGENTS.md", { maxBytes: MAX_METADATA_BYTES }))
      .content;
  } catch (error) {
    if (error instanceof ChatRoomError && error.code === "NOT_FOUND")
      return null;
    throw error;
  }
}

export async function readSkills(fs: WorkspaceFs): Promise<WorkspaceSkill[]> {
  const paths: string[] = [];
  for (const root of SKILL_ROOTS) {
    try {
      const entries = await fs.list(root, {
        recursive: true,
        maxEntries: 2000,
      });
      for (const entry of entries) {
        if (entry.type === "file" && entry.path.endsWith("/SKILL.md"))
          paths.push(entry.path);
      }
    } catch (error) {
      if (!(error instanceof ChatRoomError) || error.code !== "NOT_FOUND")
        throw error;
    }
  }

  return Promise.all(
    [...new Set(paths)].sort().map(async (skillPath) => {
      const fallbackName = path.posix.basename(path.posix.dirname(skillPath));
      try {
        const file = await fs.read(skillPath, { maxBytes: MAX_METADATA_BYTES });
        const metadata = parseSkillFrontmatter(file.content);
        return {
          name: metadata.name || fallbackName,
          description: metadata.description,
          path: skillPath,
        };
      } catch (error) {
        if (!(error instanceof ChatRoomError) || error.code !== "NOT_FOUND")
          throw error;
        return { name: fallbackName, description: "", path: skillPath };
      }
    }),
  );
}

function parseSkillFrontmatter(content: string): {
  name: string;
  description: string;
} {
  const lines = content
    .replace(/^\uFEFF/, "")
    .replaceAll("\r\n", "\n")
    .split("\n");
  if (lines[0]?.trim() !== "---") return { name: "", description: "" };
  const end = lines.findIndex(
    (line, index) => index > 0 && ["---", "..."].includes(line.trim()),
  );
  if (end < 0) return { name: "", description: "" };

  const values = new Map<string, string>();
  for (let index = 1; index < end; index++) {
    const match = /^([A-Za-z0-9_-]+):(?:\s*(.*))?$/.exec(lines[index] ?? "");
    if (!match) continue;
    const key = match[1] ?? "";
    if (key !== "name" && key !== "description") continue;
    const raw = match[2] ?? "";
    if (/^[>|][+-]?\d?$/.test(raw.trim())) {
      const block: string[] = [];
      while (index + 1 < end) {
        const next = lines[index + 1] ?? "";
        if (next && !/^\s/.test(next)) break;
        index++;
        block.push(next.replace(/^\s+/, ""));
      }
      values.set(
        key,
        raw.trim().startsWith(">")
          ? block.join(" ").replace(/\s+/g, " ").trim()
          : block.join("\n").trim(),
      );
      continue;
    }
    values.set(key, parseYamlScalar(raw));
  }
  return {
    name: values.get("name")?.trim() ?? "",
    description: values.get("description")?.trim() ?? "",
  };
}

function parseYamlScalar(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      return JSON.parse(trimmed) as string;
    } catch {
      return trimmed.slice(1, -1);
    }
  }
  if (trimmed.length >= 2 && trimmed.startsWith("'") && trimmed.endsWith("'"))
    return trimmed.slice(1, -1).replaceAll("''", "'");
  return trimmed;
}
