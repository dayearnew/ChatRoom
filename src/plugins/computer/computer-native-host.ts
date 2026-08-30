import { randomUUID } from "node:crypto";
import {
  spawn,
  spawnSync,
  type ChildProcessWithoutNullStreams,
} from "node:child_process";
import { chmodSync, existsSync, rmSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { createInterface, type Interface } from "node:readline";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ChatRoomError } from "../../core/errors/chatroom-error.js";
import {
  COMPUTER_NATIVE_PROTOCOL_VERSION,
  nativeError,
  parseNativeEnvelope,
  type ComputerNativeMethod,
} from "./computer-protocol.js";
import type { ComputerPlatform } from "./types.js";

interface PendingRequest {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: NodeJS.Timeout;
}

export class ComputerNativeHost {
  private child: ChildProcessWithoutNullStreams | null = null;
  private socket: Socket | null = null;
  private socketServer: Server | null = null;
  private socketPath: string | null = null;
  private lines: Interface | null = null;
  private starting: Promise<void> | null = null;
  private readonly pending = new Map<string, PendingRequest>();
  private sequence = 0;

  get platform(): ComputerPlatform {
    if (process.platform === "darwin") return "macos";
    if (process.platform === "win32") return "windows";
    if (process.platform === "linux") return "linux";
    return "unsupported";
  }

  get idle(): boolean {
    return this.pending.size === 0;
  }

  async request(
    method: ComputerNativeMethod,
    params: unknown,
  ): Promise<unknown> {
    await this.ensureStarted();
    const id = `computer_${++this.sequence}`;
    const timeoutMs = requestTimeoutMs(method);
    const promise = new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        const error = new ChatRoomError(
          "INTERNAL",
          `Computer helper ${method} request timed out after ${timeoutMs} ms`,
        );
        reject(error);
        this.reset(error);
      }, timeoutMs);
      timer.unref();
      this.pending.set(id, { resolve, reject, timer });
    });

    const line = `${JSON.stringify({
      protocol: COMPUTER_NATIVE_PROTOCOL_VERSION,
      id,
      method,
      params,
    })}\n`;
    if (this.platform === "macos") this.socket!.write(line);
    else this.child!.stdin.write(line);
    return promise;
  }

  restart(reason = "Computer helper restarting"): void {
    this.reset(new Error(reason));
  }

  async dispose(): Promise<void> {
    this.reset(new Error("Computer helper stopped"));
  }

  private async ensureStarted(): Promise<void> {
    const platform = this.platform;
    if (platform === "macos" && this.socket && !this.socket.destroyed) return;
    if (
      (platform === "windows" || platform === "linux") &&
      this.child &&
      !this.child.killed
    )
      return;
    if (this.starting) return this.starting;

    this.starting = this.startHelper(platform);
    try {
      await this.starting;
    } finally {
      this.starting = null;
    }
  }

  private startHelper(platform: ComputerPlatform): Promise<void> {
    switch (platform) {
      case "macos":
        return this.startMacHelper();
      case "windows":
        return this.startPipeHelper(windowsHelperPath(), "Windows");
      case "linux":
        return this.startPipeHelper(
          linuxHelperPath(),
          "Linux X11",
          linuxDesktopEnvironment(),
        );
      case "unsupported":
        return Promise.reject(
          new ChatRoomError(
            "UNSUPPORTED",
            "Computer Use is supported only on macOS, Windows, and Linux X11",
          ),
        );
    }
  }

  private async startMacHelper(): Promise<void> {
    const app = macHelperAppPath();
    if (!app)
      throw new ChatRoomError(
        "UNSUPPORTED",
        "macOS Computer helper is missing",
      );

    this.cleanupSocketPath();
    const socketPath = path.join(
      "/tmp",
      `chatroom-c-${process.pid}-${randomUUID().slice(0, 8)}.sock`,
    );
    this.socketPath = socketPath;

    await new Promise<void>((resolve, reject) => {
      const server = createServer();
      this.socketServer = server;
      let settled = false;
      const timer = setTimeout(
        () => fail(new Error("Computer helper connection timed out")),
        10_000,
      );
      timer.unref();

      const cleanupServer = () => {
        clearTimeout(timer);
        if (this.socketServer === server) this.socketServer = null;
        server.close();
      };
      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        cleanupServer();
        this.cleanupSocketPath();
        reject(error);
      };

      server.once("error", fail);
      server.once("connection", (socket) => {
        if (settled) {
          socket.destroy();
          return;
        }
        settled = true;
        server.removeListener("error", fail);
        cleanupServer();
        this.attachSocket(socket);
        resolve();
      });

      server.listen(socketPath, () => {
        chmodSync(socketPath, 0o600);
        const launcher = spawn(
          "/usr/bin/open",
          ["-n", "-g", app, "--args", "--connect", socketPath],
          { stdio: "ignore" },
        );
        launcher.once("error", fail);
      });
    });
  }

  private attachSocket(socket: Socket): void {
    this.socket = socket;
    this.lines = createInterface({ input: socket });
    this.lines.on("line", (line) => this.handleLine(line));
    socket.once("error", (error) => this.failTransport(socket, error));
    socket.once("close", () =>
      this.failTransport(socket, new Error("Computer helper exited")),
    );
  }

  private async startPipeHelper(
    executable: string | null,
    platformName: string,
    env: NodeJS.ProcessEnv = process.env,
  ): Promise<void> {
    if (!executable)
      throw new ChatRoomError(
        "UNSUPPORTED",
        `${platformName} Computer helper is missing`,
      );

    const child = spawn(executable, [], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: process.platform === "win32",
      env,
    });
    this.child = child;
    this.lines = createInterface({ input: child.stdout });
    this.lines.on("line", (line) => this.handleLine(line));
    child.stderr.on("data", (chunk) =>
      console.error("[computer-helper]", String(chunk).trimEnd()),
    );
    child.once("error", (error) => this.failTransport(child, error));
    child.once("exit", () =>
      this.failTransport(child, new Error("Computer helper exited")),
    );
  }

  private failTransport(
    transport: Socket | ChildProcessWithoutNullStreams,
    error: Error,
  ): void {
    const isCurrentSocket = transport === this.socket;
    const isCurrentChild = transport === this.child;
    if (!isCurrentSocket && !isCurrentChild) return;
    if (isCurrentSocket) this.socket = null;
    if (isCurrentChild) this.child = null;
    this.lines?.close();
    this.lines = null;
    this.cleanupSocketPath();
    this.rejectPending(error);
  }

  private reset(error: Error): void {
    this.lines?.close();
    this.lines = null;
    this.socket?.destroy();
    this.socket = null;
    this.socketServer?.close();
    this.socketServer = null;
    this.child?.kill();
    this.child = null;
    this.cleanupSocketPath();
    this.rejectPending(error);
  }

  private rejectPending(error: Error): void {
    for (const item of this.pending.values()) {
      clearTimeout(item.timer);
      item.reject(error);
    }
    this.pending.clear();
  }

  private cleanupSocketPath(): void {
    if (!this.socketPath) return;
    rmSync(this.socketPath, { force: true });
    this.socketPath = null;
  }

  private handleLine(line: string): void {
    let raw: unknown;
    try {
      raw = JSON.parse(line) as unknown;
    } catch {
      return;
    }

    const rawId =
      raw && typeof raw === "object" && "id" in raw
        ? (raw as { id?: unknown }).id
        : undefined;
    if (typeof rawId !== "string") return;
    const pending = this.pending.get(rawId);
    if (!pending) return;

    let message;
    try {
      message = parseNativeEnvelope(raw);
    } catch (error) {
      this.pending.delete(rawId);
      clearTimeout(pending.timer);
      pending.reject(error as Error);
      return;
    }

    this.pending.delete(message.id);
    clearTimeout(pending.timer);
    if (message.error) pending.reject(nativeError(message.error));
    else pending.resolve(message.result);
  }
}

function requestTimeoutMs(method: ComputerNativeMethod): number {
  switch (method) {
    case "status":
      return 5_000;
    case "snapshot":
      return 15_000;
    case "requestPermission":
      return 30_000;
    case "action":
      return 60_000;
  }
}

function projectRoot(): string {
  const current = fileURLToPath(import.meta.url);
  return path.resolve(path.dirname(current), "../../..");
}

function macHelperAppPath(): string | null {
  return nativeHelperPath("macos", "ChatRoomComputerHelper.app");
}

function windowsHelperPath(): string | null {
  return nativeHelperPath("windows", "chatroom-computer-helper.exe");
}

function linuxHelperPath(): string | null {
  return nativeHelperPath("linux", "chatroom-computer-helper");
}

function nativeHelperPath(...parts: string[]): string | null {
  const target = path.join(projectRoot(), "dist", "native", ...parts);
  return existsSync(target) ? target : null;
}

function linuxDesktopEnvironment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  const uid = typeof process.getuid === "function" ? process.getuid() : null;

  if (!env.XDG_RUNTIME_DIR && uid !== null) {
    const runtimeDir = `/run/user/${uid}`;
    if (existsSync(runtimeDir)) env.XDG_RUNTIME_DIR = runtimeDir;
  }

  if (!env.DISPLAY) {
    const display = activeX11Display(uid);
    if (display) {
      env.DISPLAY = display;
      env.XDG_SESSION_TYPE = "x11";
    }
  }

  if (!env.XAUTHORITY) {
    const candidates = [
      env.HOME ? path.join(env.HOME, ".Xauthority") : null,
      env.XDG_RUNTIME_DIR
        ? path.join(env.XDG_RUNTIME_DIR, "gdm", "Xauthority")
        : null,
    ];
    const authority = candidates.find(
      (candidate): candidate is string => !!candidate && existsSync(candidate),
    );
    if (authority) env.XAUTHORITY = authority;
  }

  if (!env.DBUS_SESSION_BUS_ADDRESS && env.XDG_RUNTIME_DIR) {
    const bus = path.join(env.XDG_RUNTIME_DIR, "bus");
    if (existsSync(bus)) env.DBUS_SESSION_BUS_ADDRESS = `unix:path=${bus}`;
  }
  return env;
}

function activeX11Display(uid: number | null): string | null {
  if (process.platform !== "linux" || uid === null) return null;
  const loginctl = existsSync("/usr/bin/loginctl")
    ? "/usr/bin/loginctl"
    : "loginctl";
  const sessions = spawnSync(
    loginctl,
    ["list-sessions", "--no-legend", "--no-pager"],
    {
      encoding: "utf8",
      timeout: 2_000,
    },
  );
  if (sessions.status !== 0 || !sessions.stdout) return null;

  const userId = String(uid);
  for (const line of sessions.stdout.split("\n")) {
    const [sessionId, sessionUid] = line.trim().split(/\s+/, 3);
    if (!sessionId || sessionUid !== userId) continue;
    const details = spawnSync(
      loginctl,
      [
        "show-session",
        sessionId,
        "--no-pager",
        "-p",
        "Type",
        "-p",
        "Active",
        "-p",
        "Display",
      ],
      { encoding: "utf8", timeout: 2_000 },
    );
    if (details.status !== 0 || !details.stdout) continue;
    const values = Object.fromEntries(
      details.stdout
        .split("\n")
        .map((item) => item.split("=", 2))
        .filter((item): item is [string, string] => item.length === 2),
    );
    if (values.Type === "x11" && values.Active === "yes" && values.Display) {
      return values.Display;
    }
  }
  return null;
}
