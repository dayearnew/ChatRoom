import { mkdtemp, mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ChatRoomConfig } from "../../src/config/types.js";
import {
  createApplication,
  type ApplicationComponents,
} from "../../src/app/application.js";
import type { ProcessSupervisor } from "../../src/plugins/process/process-supervisor.js";
import type { ProcessSnapshot } from "../../src/plugins/process/types.js";

export interface TestRuntime {
  root: string;
  workspaceRoot: string;
  config: ChatRoomConfig;
  components: ApplicationComponents;
  cleanup(): Promise<void>;
}

export async function createTestRuntime(
  options: {
    port?: number;
    maxOutputBytes?: number;
    maxCompletedProcesses?: number;
    configure?: (config: ChatRoomConfig) => void;
  } = {},
): Promise<TestRuntime> {
  const root = await mkdtemp(path.join(os.tmpdir(), "chatroom-test-"));
  const workspaceRoot = path.join(root, "workspace");
  const dataDir = path.join(root, "data");
  await mkdir(workspaceRoot, { recursive: true });
  const config: ChatRoomConfig = {
    allowedRoots: [root],
    dataDir,
    databasePath: path.join(dataDir, "chatroom.sqlite"),
    server: { host: "127.0.0.1", port: options.port ?? 0 },
    auth: {
      localWebAuth: false,
      ownerToken: "test-owner-token",
      mcpPublicBaseUrl: null,
      webPublicBaseUrl: null,
      allowedRedirectHosts: ["localhost", "127.0.0.1"],
    },
    operations: { maxPayloadBytes: 16 * 1024 },
    process: {
      maxOutputBytes: options.maxOutputBytes ?? 16 * 1024,
      defaultTimeoutMs: 10_000,
      maxCompletedProcesses: options.maxCompletedProcesses ?? 50,
    },
  };
  options.configure?.(config);
  const components = await createApplication(config);
  return {
    root,
    workspaceRoot,
    config,
    components,
    cleanup: async () => {
      await components.http.close().catch(() => undefined);
      await components.plugins.stop().catch(() => undefined);
      try {
        components.database.close();
      } catch {}
      await rm(root, { recursive: true, force: true });
    },
  };
}

export async function waitForProcess(
  processes: ProcessSupervisor,
  processId: string,
  timeoutMs = 5000,
): Promise<ProcessSnapshot> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const snapshot = processes.read(processId);
    if (snapshot.state !== "running") return snapshot;
    if (Date.now() >= deadline)
      throw new Error(`Process did not settle: ${processId}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
