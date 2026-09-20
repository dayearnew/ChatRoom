import path from "node:path";
import { ChatRoomError } from "#core/errors/chatroom-error";
import type { WorkspaceFs } from "./workspace-fs.js";
import type { WorkspaceSkill } from "./types.js";

const SKILL_ROOTS = [".agents/skills", ".claude/skills", ".chatroom/skills"];
const MAX_METADATA_BYTES = 64 * 1024;
const MAX_SUMMARY_BYTES = 8 * 1024;

export function readSummary(fs: WorkspaceFs): Promise<string | null> {
  return readOptionalText(fs, ".chatroom/summary.md", MAX_SUMMARY_BYTES);
}

export function readPresetPrompt(fs: WorkspaceFs): Promise<string | null> {
  return readOptionalText(fs, ".chatroom/prompt.md", MAX_METADATA_BYTES);
}

export function readInstructions(fs: WorkspaceFs): Promise<string | null> {
  return readOptionalText(fs, "AGENTS.md", MAX_METADATA_BYTES);
}

export async function readSkills(fs: WorkspaceFs): Promise<WorkspaceSkill[]> {
  const entriesByRoot = await Promise.all(
    SKILL_ROOTS.map(async (root) => {
      try {
        return await fs.list(root, { recursive: true, maxEntries: 2000 });
      } catch (error) {
        if (error instanceof ChatRoomError && error.code === "NOT_FOUND")
          return [];
        throw error;
      }
    }),
  );
  const paths = entriesByRoot.flatMap((entries) =>
    entries
      .filter(
        (entry) => entry.type === "file" && entry.path.endsWith("/SKILL.md"),
      )
      .map((entry) => entry.path),
  );

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

async function readOptionalText(
  fs: WorkspaceFs,
  relativePath: string,
  maxBytes: number,
): Promise<string | null> {
  try {
    const content = (await fs.read(relativePath, { maxBytes })).content;
    return content.trim() ? content : null;
  } catch (error) {
    if (error instanceof ChatRoomError && error.code === "NOT_FOUND")
      return null;
    throw error;
  }
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
