import { createPrivateKey, sign } from "node:crypto";
import http, { type ClientRequest, type IncomingMessage } from "node:http";
import WebSocket from "ws";
import {
  cloudServiceForPublicService,
  type CloudLeaseState,
  type PublicService,
} from "./types.js";

const PROTOCOL = "chatroom-tunnel-v1";
const HIGH_WATER = 8 * 1024 * 1024;
const LOW_WATER = 2 * 1024 * 1024;
const READY_TIMEOUT_MS = 10_000;
const HEARTBEAT_INTERVAL_MS = 20_000;

interface TunnelTimings {
  readyTimeoutMs: number;
  heartbeatIntervalMs: number;
}

interface StreamState {
  request: ClientRequest;
  response: IncomingMessage | null;
}

type ControlMessage =
  | { type: "challenge"; nonce: string }
  | { type: "ready" }
  | {
      type: "open";
      streamId: number;
      service: PublicService;
      method: string;
      path: string;
      headers: Record<string, string>;
    }
  | { type: "end"; streamId: number }
  | { type: "abort"; streamId: number }
  | { type: "pause"; streamId: number }
  | { type: "resume"; streamId: number };

export class CloudTunnelClient {
  private socket: WebSocket | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private readyTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private awaitingPong = false;
  private stopped = true;
  private attempts = 0;
  private closeWhenIdle: "stop" | "reconnect" | null = null;
  private acceptingServices: Set<CloudLeaseState["services"][number]>;
  private readonly streams = new Map<number, StreamState>();
  private readonly timings: TunnelTimings;

  constructor(
    private lease: CloudLeaseState,
    private readonly identity: { devicePrivateKey: string },
    private readonly local: { host: string; port: number },
    private readonly callbacks: {
      onConnected(): void;
      onDisconnected(): void;
      onError(error: Error): void;
    },
    timings: Partial<TunnelTimings> = {},
  ) {
    this.acceptingServices = new Set(lease.services);
    this.timings = {
      readyTimeoutMs: timings.readyTimeoutMs ?? READY_TIMEOUT_MS,
      heartbeatIntervalMs: timings.heartbeatIntervalMs ?? HEARTBEAT_INTERVAL_MS,
    };
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.closeWhenIdle = null;
    this.acceptingServices = new Set(this.lease.services);
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.closeWhenIdle = null;
    this.acceptingServices.clear();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.clearSocketTimers();
    this.socket?.close();
    this.socket = null;
    for (const stream of this.streams.values()) stream.request.destroy();
    this.streams.clear();
  }

  drainAndStop(): void {
    this.stopped = true;
    this.acceptingServices.clear();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.clearSocketTimers();
    if (this.streams.size === 0) {
      this.closeWhenIdle = null;
      this.socket?.close();
      return;
    }
    this.closeWhenIdle = "stop";
  }

  updateLease(lease: CloudLeaseState): void {
    const tunnelChanged = lease.tunnelUrl !== this.lease.tunnelUrl;
    const removesService = this.lease.services.some(
      (service) => !lease.services.includes(service),
    );
    this.lease = lease;
    this.acceptingServices = new Set(lease.services);
    if (this.stopped) return;

    if (!tunnelChanged) {
      if (this.socket?.readyState === WebSocket.OPEN)
        this.send({ type: "update-lease", lease: lease.token });
      return;
    }

    if (!removesService || this.streams.size === 0) {
      this.socket?.close();
      return;
    }
    this.closeWhenIdle = "reconnect";
  }

  private connect(): void {
    if (this.stopped || this.socket) return;
    const socket = new WebSocket(this.lease.tunnelUrl, PROTOCOL);
    this.socket = socket;
    socket.binaryType = "nodebuffer";
    this.startReadyTimeout(socket);
    socket.on("message", (data, isBinary) => {
      try {
        if (isBinary) this.handleBinary(Buffer.from(data as Buffer));
        else this.handleControl(JSON.parse(data.toString()) as ControlMessage);
      } catch (error) {
        this.callbacks.onError(
          error instanceof Error ? error : new Error(String(error)),
        );
        socket.close();
      }
    });
    socket.on("pong", () => {
      if (this.socket === socket) this.awaitingPong = false;
    });
    socket.on("close", () => {
      if (this.socket === socket) {
        this.clearSocketTimers();
        this.socket = null;
      }
      this.closeWhenIdle = null;
      for (const stream of this.streams.values()) stream.request.destroy();
      this.streams.clear();
      this.callbacks.onDisconnected();
      if (!this.stopped) this.scheduleReconnect();
    });
    socket.on("error", (error) => this.failSocket(socket, error));
  }

  private handleControl(message: ControlMessage): void {
    if (message.type === "challenge") {
      this.send({
        type: "authenticate",
        lease: this.lease.token,
        signature: signChallenge(
          message.nonce,
          this.lease.token,
          this.identity.devicePrivateKey,
        ),
      });
      return;
    }
    if (message.type === "ready") {
      this.attempts = 0;
      this.clearReadyTimeout();
      if (this.socket) this.startHeartbeat(this.socket);
      this.callbacks.onConnected();
      return;
    }
    if (message.type === "open") {
      this.openStream(message);
      return;
    }
    const stream = this.streams.get(message.streamId);
    if (!stream) return;
    if (message.type === "end") stream.request.end();
    else if (message.type === "abort") {
      stream.request.destroy();
      stream.response?.destroy();
      this.finishStream(message.streamId);
    } else if (message.type === "pause") stream.response?.pause();
    else if (message.type === "resume") stream.response?.resume();
  }

  private openStream(message: Extract<ControlMessage, { type: "open" }>): void {
    const service = cloudServiceForPublicService(message.service);
    if (
      !this.acceptingServices.has(service) ||
      !allowedPath(message.service, message.path)
    ) {
      this.send({
        type: "response",
        streamId: message.streamId,
        status: 404,
        headers: { "content-type": "text/plain" },
      });
      this.send({ type: "response-end", streamId: message.streamId });
      return;
    }
    const headers = sanitizeHeaders(message.headers);
    const request = http.request(
      {
        host: this.local.host,
        port: this.local.port,
        method: message.method,
        path: message.path,
        headers,
      },
      (response) => {
        const stream = this.streams.get(message.streamId);
        if (stream) stream.response = response;
        this.send({
          type: "response",
          streamId: message.streamId,
          status: response.statusCode ?? 502,
          headers: responseHeaders(response.headers),
        });
        response.on("data", (chunk: Buffer) => {
          if (!this.sendBinary(message.streamId, Buffer.from(chunk))) {
            response.pause();
            const timer = setInterval(() => {
              if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
                clearInterval(timer);
                return;
              }
              if (this.socket.bufferedAmount <= LOW_WATER) {
                clearInterval(timer);
                response.resume();
              }
            }, 10);
            timer.unref();
          }
        });
        response.on("end", () => {
          this.send({ type: "response-end", streamId: message.streamId });
          this.finishStream(message.streamId);
        });
        response.on("error", () => {
          this.send({ type: "abort", streamId: message.streamId });
          this.finishStream(message.streamId);
        });
      },
    );
    request.on("drain", () =>
      this.send({ type: "resume", streamId: message.streamId }),
    );
    request.on("error", () => {
      this.send({
        type: "response",
        streamId: message.streamId,
        status: 502,
        headers: {},
      });
      this.send({ type: "response-end", streamId: message.streamId });
      this.finishStream(message.streamId);
    });
    this.streams.set(message.streamId, { request, response: null });
  }

  private finishStream(streamId: number): void {
    this.streams.delete(streamId);
    if (this.streams.size !== 0 || !this.closeWhenIdle) return;
    const action = this.closeWhenIdle;
    this.closeWhenIdle = null;
    if (action === "stop") {
      this.socket?.close();
      return;
    }
    this.socket?.close();
  }

  private handleBinary(frame: Buffer): void {
    if (frame.length < 4) throw new Error("Invalid tunnel data frame");
    const streamId = frame.readUInt32BE(0);
    const stream = this.streams.get(streamId);
    if (!stream) return;
    if (!stream.request.write(frame.subarray(4)))
      this.send({ type: "pause", streamId });
  }

  private send(message: unknown): void {
    if (this.socket?.readyState === WebSocket.OPEN)
      this.socket.send(JSON.stringify(message));
  }

  private sendBinary(streamId: number, chunk: Buffer): boolean {
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) return false;
    const frame = Buffer.allocUnsafe(4 + chunk.length);
    frame.writeUInt32BE(streamId, 0);
    chunk.copy(frame, 4);
    socket.send(frame, { binary: true });
    return socket.bufferedAmount < HIGH_WATER;
  }

  private startReadyTimeout(socket: WebSocket): void {
    this.clearReadyTimeout();
    this.readyTimer = setTimeout(() => {
      this.readyTimer = null;
      this.failSocket(socket, new Error("Tunnel connection timed out"));
    }, this.timings.readyTimeoutMs);
    this.readyTimer.unref();
  }

  private clearReadyTimeout(): void {
    if (this.readyTimer) clearTimeout(this.readyTimer);
    this.readyTimer = null;
  }

  private startHeartbeat(socket: WebSocket): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.awaitingPong = false;
    this.heartbeatTimer = setInterval(() => {
      if (this.socket !== socket || socket.readyState !== WebSocket.OPEN)
        return;
      if (this.awaitingPong) {
        this.failSocket(socket, new Error("Tunnel heartbeat timed out"));
        return;
      }
      this.awaitingPong = true;
      socket.ping();
    }, this.timings.heartbeatIntervalMs);
    this.heartbeatTimer.unref();
  }

  private clearSocketTimers(): void {
    this.clearReadyTimeout();
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
    this.awaitingPong = false;
  }

  private failSocket(socket: WebSocket, error: Error): void {
    if (this.socket !== socket) return;
    this.callbacks.onError(error);
    this.clearSocketTimers();
    this.socket = null;
    socket.terminate();
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.stopped) return;
    const delay =
      Math.min(30_000, 500 * 2 ** Math.min(this.attempts++, 6)) *
      (0.8 + Math.random() * 0.4);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
    this.reconnectTimer.unref();
  }
}

function signChallenge(
  nonce: string,
  lease: string,
  privateKey: string,
): string {
  const key = createPrivateKey({
    key: Buffer.from(privateKey, "base64url"),
    format: "der",
    type: "pkcs8",
  });
  return sign(
    null,
    Buffer.from(`chatroom-tunnel-v1\n${nonce}\n${lease}`),
    key,
  ).toString("base64url");
}
function allowedPath(service: PublicService, value: string): boolean {
  const pathname = new URL(value, "http://localhost").pathname;
  if (service === "mcp")
    return (
      pathname === "/mcp" ||
      pathname.startsWith("/.well-known/oauth-") ||
      pathname.startsWith("/oauth/")
    );
  return (
    pathname !== "/mcp" &&
    !pathname.startsWith("/oauth/") &&
    !pathname.startsWith("/.well-known/oauth-")
  );
}
function sanitizeHeaders(
  headers: Record<string, string>,
): Record<string, string> {
  const blocked = new Set([
    "connection",
    "proxy-connection",
    "keep-alive",
    "transfer-encoding",
    "upgrade",
  ]);
  return Object.fromEntries(
    Object.entries(headers).filter(([key]) => !blocked.has(key.toLowerCase())),
  );
}
function responseHeaders(
  headers: http.IncomingHttpHeaders,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (
      value === undefined ||
      ["connection", "keep-alive", "transfer-encoding", "upgrade"].includes(
        key.toLowerCase(),
      )
    )
      continue;
    result[key] = Array.isArray(value) ? value.join(", ") : value;
  }
  return result;
}
