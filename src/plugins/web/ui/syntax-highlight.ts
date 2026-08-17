import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import c from "highlight.js/lib/languages/c";
import cpp from "highlight.js/lib/languages/cpp";
import css from "highlight.js/lib/languages/css";
import diff from "highlight.js/lib/languages/diff";
import go from "highlight.js/lib/languages/go";
import ini from "highlight.js/lib/languages/ini";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import markdown from "highlight.js/lib/languages/markdown";
import python from "highlight.js/lib/languages/python";
import rust from "highlight.js/lib/languages/rust";
import shell from "highlight.js/lib/languages/shell";
import sql from "highlight.js/lib/languages/sql";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";

hljs.registerLanguage("bash", bash);
hljs.registerLanguage("c", c);
hljs.registerLanguage("cpp", cpp);
hljs.registerLanguage("css", css);
hljs.registerLanguage("diff", diff);
hljs.registerLanguage("go", go);
hljs.registerLanguage("ini", ini);
hljs.registerLanguage("java", java);
hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("json", json);
hljs.registerLanguage("markdown", markdown);
hljs.registerLanguage("python", python);
hljs.registerLanguage("rust", rust);
hljs.registerLanguage("shell", shell);
hljs.registerLanguage("sql", sql);
hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("xml", xml);
hljs.registerLanguage("yaml", yaml);

const extensionLanguages: Record<string, string> = {
  bash: "bash",
  c: "c",
  cc: "cpp",
  cpp: "cpp",
  cxx: "cpp",
  css: "css",
  diff: "diff",
  go: "go",
  h: "c",
  hpp: "cpp",
  html: "xml",
  htm: "xml",
  ini: "ini",
  conf: "ini",
  config: "ini",
  toml: "ini",
  java: "java",
  js: "javascript",
  cjs: "javascript",
  mjs: "javascript",
  json: "json",
  jsonc: "json",
  md: "markdown",
  py: "python",
  rs: "rust",
  sh: "bash",
  sql: "sql",
  ts: "typescript",
  tsx: "typescript",
  vue: "xml",
  xml: "xml",
  yaml: "yaml",
  yml: "yaml",
};

const basenameLanguages: Record<string, string> = {
  ".env": "ini",
  ".editorconfig": "ini",
  dockerfile: "bash",
  makefile: "bash",
};

export function languageForFilename(filename?: string): string | null {
  if (!filename) return null;
  const base = filename.split(/[\\/]/).pop()?.toLowerCase() ?? "";
  if (base === "package.json" || base === "tsconfig.json") return "json";
  if (base === "dockerfile" || base === "makefile") return "bash";
  const dot = base.lastIndexOf(".");
  if (dot === -1) return basenameLanguages[base] ?? null;
  return extensionLanguages[base.slice(dot + 1)] ?? null;
}

export function highlightSource(
  source: string,
  options: { filename?: string; language?: string | null } = {},
): string | null {
  const language = options.language ?? languageForFilename(options.filename);
  if (!language || !hljs.getLanguage(language)) return null;
  return hljs.highlight(source, { language, ignoreIllegals: true }).value;
}
