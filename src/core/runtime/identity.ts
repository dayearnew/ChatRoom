import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const CHATROOM_NAME = "ChatRoom";

const packageJsonPath = fileURLToPath(
  new URL("../../../package.json", import.meta.url),
);
const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
  version?: unknown;
};

if (typeof packageJson.version !== "string" || !packageJson.version) {
  throw new Error("ChatRoom package version is missing");
}

export const CHATROOM_VERSION = packageJson.version;
