import { randomUUID } from "node:crypto";
import { ChatRoomError } from "../../core/errors/chatroom-error.js";
import type { RuntimeEventBus } from "../../app/event-bus.js";
import type { ComputerSettingsRepository } from "./computer-settings-repository.js";
import type {
  ComputerAccessScope,
  ComputerActionRequest,
  ComputerActionResult,
  ComputerBackend,
  ComputerPermission,
  ComputerSettings,
  ComputerSnapshot,
  ComputerSnapshotRequest,
  ComputerStatus,
} from "./types.js";

type ComputerSettingsStore = Pick<ComputerSettingsRepository, "get" | "set">;

export class ComputerService {
  private revision = 0;
  private currentSnapshotId: string | null = null;
  private latestSnapshotValue: ComputerSnapshot | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly backend: ComputerBackend,
    private readonly settingsRepository: ComputerSettingsStore,
    private readonly events: RuntimeEventBus,
  ) {}

  settings(): ComputerSettings {
    return this.settingsRepository.get();
  }

  latestSnapshot(scope: ComputerAccessScope): ComputerSnapshot | null {
    const settings = this.settings();
    if (!settings.enabled) return null;
    this.assertScopeAllowed(scope, settings);
    return this.latestSnapshotValue;
  }

  requestPermission(permission: ComputerPermission): Promise<ComputerStatus> {
    return this.serial(async () => {
      const base = await this.backend.requestPermission(permission);
      return { ...base, settings: this.settings() };
    });
  }

  async status(): Promise<ComputerStatus> {
    const base = await this.backend.status();
    return { ...base, settings: this.settings() };
  }

  setSettings(
    patch: Partial<Pick<ComputerSettings, "enabled" | "remoteAccess">>,
  ): ComputerSettings {
    const next = this.settingsRepository.set({ ...this.settings(), ...patch });
    if (!next.enabled) {
      this.currentSnapshotId = null;
      this.latestSnapshotValue = null;
      void this.backend.dispose().catch(() => undefined);
    }
    this.events.emit({ type: "computer-settings", settings: next });
    return next;
  }

  snapshot(
    scope: ComputerAccessScope,
    request: ComputerSnapshotRequest,
  ): Promise<ComputerSnapshot> {
    return this.serial(async () => {
      this.assertAllowed(scope);
      this.currentSnapshotId = null;
      const value = await this.backend.snapshot(request, this.revision);
      this.currentSnapshotId = value.snapshotId || `snap_${randomUUID()}`;
      value.snapshotId = this.currentSnapshotId;
      value.revision = this.revision;
      this.latestSnapshotValue = value;
      return value;
    });
  }

  action(
    scope: ComputerAccessScope,
    request: ComputerActionRequest,
  ): Promise<ComputerActionResult> {
    return this.serial(async () => {
      this.assertAllowed(scope);
      this.assertActionBudget(request);
      const referencesElements = request.actions.some(
        (action) => "elementId" in action && action.elementId !== undefined,
      );
      if (referencesElements && !request.snapshotId)
        throw new ChatRoomError(
          "CONFLICT",
          "Actions using elementId require the latest snapshotId",
        );
      if (request.snapshotId && request.snapshotId !== this.currentSnapshotId)
        throw new ChatRoomError(
          "CONFLICT",
          "Computer snapshot is stale; take a new snapshot before acting",
        );
      this.currentSnapshotId = null;
      const result = await this.backend.action(request, ++this.revision);
      this.currentSnapshotId = result.snapshot?.snapshotId ?? null;
      if (result.snapshot) this.latestSnapshotValue = result.snapshot;
      return result;
    });
  }

  async shutdown(): Promise<void> {
    this.currentSnapshotId = null;
    this.latestSnapshotValue = null;
    await this.backend.dispose();
  }

  private assertActionBudget(request: ComputerActionRequest): void {
    const durationMs = request.actions.reduce((total, action) => {
      if (action.type === "wait") return total + action.ms;
      if (action.type === "drag") return total + (action.durationMs ?? 0);
      return total;
    }, 0);
    if (durationMs > 30_000)
      throw new ChatRoomError(
        "INVALID_INPUT",
        "Computer action batch exceeds the 30 second execution budget",
      );
  }

  private assertAllowed(scope: ComputerAccessScope): void {
    const settings = this.settings();
    if (!settings.enabled)
      throw new ChatRoomError("FORBIDDEN", "Computer Use is disabled");
    this.assertScopeAllowed(scope, settings);
  }

  private assertScopeAllowed(
    scope: ComputerAccessScope,
    settings: ComputerSettings,
  ): void {
    if (scope === "remote" && !settings.remoteAccess)
      throw new ChatRoomError("FORBIDDEN", "Remote Computer Use is disabled", {
        reason: "remote_computer_disabled",
      });
  }

  private serial<T>(action: () => Promise<T>): Promise<T> {
    const next = this.queue.then(action, action);
    this.queue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }
}
