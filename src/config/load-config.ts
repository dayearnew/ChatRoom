import { randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { ChatRoomError } from "../core/errors/chatroom-error.js";
import { platformPaths } from "./platform-paths.js";
import type { ChatRoomConfig } from "./types.js";

function rawConfigSchema() {
  const defaults = defaultConfig();
  return z
    .object({
      allowedRoots: z
        .array(z.string().min(1))
        .min(1)
        .default(defaults.allowedRoots),
      dataDir: z.string().min(1).default(defaults.dataDir),
      databasePath: z.string().min(1).optional(),
      server: z
        .object({
          host: z.string().min(1).default(defaults.server.host),
          port: z
            .number()
            .int()
            .min(1)
            .max(65535)
            .default(defaults.server.port),
        })
        .strict()
        .default(defaults.server),
      auth: z
        .object({
          localWebAuth: z.boolean().default(defaults.auth.localWebAuth),
          ownerToken: z
            .string()
            .min(1)
            .nullable()
            .default(defaults.auth.ownerToken),
          mcpPublicBaseUrl: z
            .string()
            .url()
            .nullable()
            .default(defaults.auth.mcpPublicBaseUrl),
          webPublicBaseUrl: z
            .string()
            .url()
            .nullable()
            .default(defaults.auth.webPublicBaseUrl),
          allowedRedirectHosts: z
            .array(z.string().min(1))
            .default(defaults.auth.allowedRedirectHosts),
        })
        .strict()
        .default(defaults.auth),
      operations: z
        .object({
          maxPayloadBytes: z
            .number()
            .int()
            .min(4096)
            .max(16 * 1024 * 1024)
            .default(defaults.operations.maxPayloadBytes),
        })
        .strict()
        .default(defaults.operations),
      process: z
        .object({
          maxOutputBytes: z
            .number()
            .int()
            .min(4096)
            .max(64 * 1024 * 1024)
            .default(defaults.process.maxOutputBytes),
          defaultTimeoutMs: z
            .number()
            .int()
            .min(1000)
            .max(24 * 60 * 60 * 1000)
            .default(defaults.process.defaultTimeoutMs),
          maxCompletedProcesses: z
            .number()
            .int()
            .min(0)
            .max(10_000)
            .default(defaults.process.maxCompletedProcesses),
        })
        .strict()
        .default(defaults.process),
    })
    .strict();
}

function defaultConfigPath(): string {
  return process.env.CHATROOM_CONFIG ?? platformPaths().configFile;
}

export function defaultConfig(): ChatRoomConfig {
  const paths = platformPaths();
  return {
    allowedRoots: [path.join(os.homedir(), "Projects")],
    dataDir: paths.dataDir,
    databasePath: paths.databaseFile,
    server: { host: "127.0.0.1", port: 8765 },
    auth: {
      localWebAuth: false,
      ownerToken: null,
      mcpPublicBaseUrl: null,
      webPublicBaseUrl: null,
      allowedRedirectHosts: ["chatgpt.com", "localhost", "127.0.0.1"],
    },
    operations: { maxPayloadBytes: 512 * 1024 },
    process: {
      maxOutputBytes: 512 * 1024,
      defaultTimeoutMs: 30 * 60 * 1000,
      maxCompletedProcesses: 200,
    },
  };
}

export async function loadConfig(
  configPath = defaultConfigPath(),
): Promise<ChatRoomConfig> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(configPath, "utf8")) as unknown;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      throw new ChatRoomError(
        "NOT_FOUND",
        `ChatRoom is not initialized: ${configPath}`,
      );
    throw new ChatRoomError(
      "INVALID_INPUT",
      `Cannot read config: ${configPath}`,
      undefined,
      {
        cause: error,
      },
    );
  }

  const config = validateConfig(parsed);
  validateRuntimeSecurity(config);
  return config;
}

export async function initializeConfig(): Promise<{
  config: ChatRoomConfig;
  configPath: string;
}> {
  const configPath = defaultConfigPath();
  try {
    await readFile(configPath, "utf8");
    throw new ChatRoomError("CONFLICT", `Config already exists: ${configPath}`);
  } catch (error) {
    if (error instanceof ChatRoomError) throw error;
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const config = defaultConfig();
  await mkdir(config.allowedRoots[0]!, { recursive: true, mode: 0o700 });
  config.auth.ownerToken = randomBytes(32).toString("base64url");
  await mkdir(path.dirname(configPath), { recursive: true, mode: 0o700 });
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, {
    mode: 0o600,
  });
  await chmod(configPath, 0o600).catch(() => undefined);
  return { config, configPath };
}

function validateConfig(value: unknown): ChatRoomConfig {
  const result = rawConfigSchema().safeParse(value);
  if (!result.success)
    throw new ChatRoomError("INVALID_INPUT", "Invalid ChatRoom configuration", {
      issues: result.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    });

  const dataDir = path.resolve(result.data.dataDir);
  return {
    ...result.data,
    allowedRoots: result.data.allowedRoots.map((root) => path.resolve(root)),
    dataDir,
    databasePath: path.resolve(
      result.data.databasePath ?? path.join(dataDir, "chatroom.sqlite"),
    ),
  };
}

function validateRuntimeSecurity(config: ChatRoomConfig): void {
  const loopback =
    config.server.host === "127.0.0.1" ||
    config.server.host === "::1" ||
    config.server.host === "localhost";
  if (!loopback && !config.auth.localWebAuth)
    throw new ChatRoomError(
      "FORBIDDEN",
      "auth.localWebAuth must be enabled when ChatRoom binds beyond loopback",
    );
  const authenticationUsed =
    config.auth.localWebAuth ||
    Boolean(config.auth.mcpPublicBaseUrl) ||
    Boolean(config.auth.webPublicBaseUrl);
  if (authenticationUsed && !config.auth.ownerToken)
    throw new ChatRoomError(
      "INVALID_INPUT",
      "auth.ownerToken is required when any authenticated ingress is configured",
    );
}
