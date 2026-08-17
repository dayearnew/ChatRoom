/** Static architecture guard for ChatRoom dependency directions and implementation boundaries. */
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const src = path.join(root, "src");
const files = await walk(src);
const violations = [];
const childProcessAllowed = new Set([
  "src/core/runtime/command-runner.ts",
  "src/plugins/process/infrastructure/pipe-process-backend.ts",
]);
const platformBranchAllowed = [
  "src/config/platform-paths.ts",
  "src/plugins/process/infrastructure/",
];

for (const file of files.filter((entry) => /\.(?:ts|tsx|vue)$/.test(entry))) {
  const relative = path.relative(root, file).split(path.sep).join("/");
  const content = await readFile(file, "utf8");

  if (
    content.includes("node:child_process") &&
    !childProcessAllowed.has(relative)
  ) {
    violations.push(
      `${relative}: child_process is outside an approved runtime backend`,
    );
  }

  if (
    content.includes("process.platform") &&
    !platformBranchAllowed.some(
      (allowed) => relative === allowed || relative.startsWith(allowed),
    )
  ) {
    violations.push(
      `${relative}: platform branching is outside an approved platform boundary`,
    );
  }

  if (
    relative.startsWith("src/core/") &&
    /(?:@modelcontextprotocol|express|vue|vuetify|from\s+["'][^"']*(?:infrastructure|plugins|mcp|presentation|web)\/)/i.test(
      content,
    )
  ) {
    violations.push(
      `${relative}: core depends on an adapter, plugin, protocol, or UI layer`,
    );
  }

  if (
    (relative.startsWith("src/mcp/") ||
      relative.startsWith("src/presentation/")) &&
    /from\s+["'][^"']*infrastructure\//.test(content)
  ) {
    violations.push(
      `${relative}: protocol/presentation layer bypasses the application boundary`,
    );
  }

  if (relative.endsWith(".tsx")) {
    violations.push(`${relative}: WebUI is Vue/Vuetify; TSX is not allowed`);
  }
  if (/from\s+["']react(?:\/|["'])/.test(content)) {
    violations.push(
      `${relative}: WebUI must use Vue/Vuetify; React is not allowed`,
    );
  }
}

for (const relative of [
  "src/infrastructure/http/http-server.ts",
  "src/app/application.ts",
]) {
  const lines = (await readFile(path.join(root, relative), "utf8")).split(
    /\r?\n/,
  ).length;
  if (lines > 250) {
    violations.push(
      `${relative}: composition/server entry exceeded 250 lines (${lines})`,
    );
  }
}

const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const dependencies = {
  ...(pkg.dependencies ?? {}),
  ...(pkg.devDependencies ?? {}),
};
if (
  dependencies.react ||
  dependencies["react-dom"] ||
  dependencies["@vitejs/plugin-react"]
) {
  violations.push(
    "package.json: WebUI must use Vue/Vuetify; React packages are not allowed",
  );
}
for (const required of ["vue", "vuetify"]) {
  if (!dependencies[required]) {
    violations.push(
      `package.json: missing required WebUI dependency ${required}`,
    );
  }
}

if (violations.length > 0) {
  console.error(
    `Architecture invariant violations:\n${violations.map((value) => `- ${value}`).join("\n")}`,
  );
  process.exitCode = 1;
} else {
  console.log(
    `Architecture invariants passed across ${files.length} source files.`,
  );
}

async function walk(directory) {
  const output = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) output.push(...(await walk(target)));
    else output.push(target);
  }
  return output;
}
