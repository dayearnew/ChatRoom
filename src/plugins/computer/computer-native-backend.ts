import { ChatRoomError } from "../../core/errors/chatroom-error.js";
import { ComputerNativeHost } from "./computer-native-host.js";
import { parseNativeResult } from "./computer-protocol.js";
import type {
  ComputerActionRequest,
  ComputerActionResult,
  ComputerBackend,
  ComputerPermission,
  ComputerSnapshot,
  ComputerSnapshotRequest,
  ComputerStatus,
} from "./types.js";

export class NativeComputerBackend implements ComputerBackend {
  private readonly host = new ComputerNativeHost();
  private readonly restartWhenGranted = new Set<ComputerPermission>();

  async status(): Promise<Omit<ComputerStatus, "settings">> {
    const value = await this.readStatus().catch(() => ({
      platform: this.host.platform,
      helper: "unavailable" as const,
      permissions: {
        accessibility: "unknown" as const,
        screenRecording: "unknown" as const,
      },
      displays: [],
    }));
    if (this.host.platform !== "macos" || value.helper !== "running")
      return value;

    const newlyGranted = [...this.restartWhenGranted].filter(
      (permission) => value.permissions[permission] === "granted",
    );
    if (!newlyGranted.length || !this.host.idle) return value;

    for (const permission of newlyGranted)
      this.restartWhenGranted.delete(permission);
    this.host.restart("Computer helper restarting after permission change");
    return this.readStatus();
  }

  async requestPermission(
    permission: ComputerPermission,
  ): Promise<Omit<ComputerStatus, "settings">> {
    if (this.host.platform !== "macos")
      throw new ChatRoomError(
        "UNSUPPORTED",
        "Permission requests are currently supported only on macOS",
      );

    const result = await this.host.request("requestPermission", { permission });
    const value = parseNativeResult("requestPermission", result);
    if (value.permissions[permission] !== "granted") {
      this.restartWhenGranted.add(permission);
      return value;
    }

    this.restartWhenGranted.delete(permission);
    this.host.restart("Computer helper restarting after permission change");
    return this.readStatus();
  }

  async snapshot(
    request: ComputerSnapshotRequest,
    revision: number,
  ): Promise<ComputerSnapshot> {
    const result = await this.host.request("snapshot", {
      ...request,
      revision,
    });
    return parseNativeResult("snapshot", result);
  }

  async action(
    request: ComputerActionRequest,
    revision: number,
  ): Promise<ComputerActionResult> {
    const result = await this.host.request("action", { ...request, revision });
    return parseNativeResult("action", result);
  }

  async dispose(): Promise<void> {
    this.restartWhenGranted.clear();
    await this.host.dispose();
  }

  private async readStatus(): Promise<Omit<ComputerStatus, "settings">> {
    return parseNativeResult("status", await this.host.request("status", {}));
  }
}
