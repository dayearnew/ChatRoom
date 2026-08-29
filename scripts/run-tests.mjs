import { spawnSync } from "node:child_process";
import { globSync } from "node:fs";

const files = [
  ...globSync("test/unit/**/*.test.ts"),
  ...globSync("test/integration/**/*.test.ts"),
  ...globSync("test/security/**/*.test.ts"),
].sort();

if (files.length === 0) {
  console.error("No test files were found.");
  process.exit(1);
}

const result = spawnSync(
  process.execPath,
  ["--import", "tsx", "--test", ...files],
  { stdio: "inherit" },
);

process.exit(result.status ?? 1);
