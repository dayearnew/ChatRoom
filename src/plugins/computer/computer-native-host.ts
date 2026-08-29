import { randomUUID } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
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
    if (this.platform === "macos" && this.socket && !this.socket.destroyed)
      return;
    if (this.platform === "windows" && this.child && !this.child.killed) return;
    if (this.starting) return this.starting;

    this.starting =
      this.platform === "macos"
        ? this.startMacHelper()
        : this.platform === "windows"
          ? this.startWindowsHelper()
          : Promise.reject(
              new ChatRoomError(
                "UNSUPPORTED",
                "Computer Use is supported only on macOS and Windows",
              ),
            );
    try {
      await this.starting;
    } finally {
      this.starting = null;
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

  private async startWindowsHelper(): Promise<void> {
    const executable = windowsHelperPath();
    if (!executable)
      throw new ChatRoomError(
        "UNSUPPORTED",
        "Windows Computer helper is missing",
      );

    const child = spawn(executable, [], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
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
  const app = path.join(
    projectRoot(),
    "dist",
    "native",
    "macos",
    "ChatRoomComputerHelper.app",
  );
  return existsSync(app) ? app : null;
}

function windowsHelperPath(): string | null {
  const executable = path.join(
    projectRoot(),
    "dist",
    "native",
    "windows",
    "chatroom-computer-helper.exe",
  );
  return existsSync(executable) ? executable : null;
}
