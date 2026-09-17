import type { ChatRoomConfig } from "../../config/types.js";
import { ChatRoomError } from "../../core/errors/chatroom-error.js";
import { CloudApiClient } from "./api-client.js";
import { CloudStateStore } from "./state-store.js";
import { CloudTunnelClient } from "./tunnel-client.js";
import {
  CLOUD_SERVICES,
  type CloudPersistedState,
  type CloudServiceId,
  type CloudStatus,
} from "./types.js";

interface ExternalAccessSink {
  setCloud(state: {
    mcpBaseUrl: string | null;
    webBaseUrl: string | null;
  }): void;
  clearCloud(): void;
}

export class CloudController {
  private readonly store: CloudStateStore;
  private readonly api: CloudApiClient;
  private state: CloudPersistedState | null = null;
  private tunnel: CloudTunnelClient | null = null;
  private connection: CloudStatus["connection"] = "inactive";
  private lastError: string | null = null;
  private managementTimer: NodeJS.Timeout | null = null;
  private renewalTimer: NodeJS.Timeout | null = null;
  private statusRetryTimer: NodeJS.Timeout | null = null;
  private stopped = true;
  private mutationQueue: Promise<unknown> = Promise.resolve();

  private constructor(
    private readonly config: ChatRoomConfig,
    cloudApi: string,
    private readonly externalAccess?: ExternalAccessSink,
  ) {
    this.store = new CloudStateStore(config.dataDir);
    this.api = new CloudApiClient(cloudApi);
  }

  static async create(
    config: ChatRoomConfig,
    externalAccess?: ExternalAccessSink,
  ): Promise<CloudController> {
    const apiBaseUrl = (
      process.env.CHATROOM_CLOUD_API ?? "https://chatroomcp.com"
    ).replace(/\/$/, "");
    const controller = new CloudController(config, apiBaseUrl, externalAccess);
    await controller.ensureState().catch(() => undefined);
    return controller;
  }

  status(): CloudStatus {
    const state = this.state;
    if (!state) {
      return {
        installationId: null,
        customerId: null,
        publicPrefix: null,
        desiredServices: { remote_mcp: false, remote_web: false },
        entitlements: [],
        managementSessionActive: false,
        connection: "error",
        mcpUrl: null,
        webUrl: null,
        lastError: this.lastError ?? "ChatRoom Cloud is unavailable",
      };
    }
    const lease =
      state.lease && Date.parse(state.lease.expiresAt) > Date.now()
        ? state.lease
        : null;
    return {
      installationId: state.installationId,
      customerId: state.customerId,
      publicPrefix: state.publicPrefix,
      desiredServices: { ...state.desiredServices },
      entitlements: [...state.entitlements],
      managementSessionActive: Boolean(
        state.managementSession &&
        Date.parse(state.managementSession.expiresAt) > Date.now(),
      ),
      connection: this.connection,
      mcpUrl: lease?.mcpBaseUrl ? `${lease.mcpBaseUrl}/mcp` : null,
      webUrl: lease?.webBaseUrl ?? null,
      lastError: this.lastError,
    };
  }

  start(): Promise<void> {
    return this.serial(async () => {
      if (!this.stopped) return;
      this.stopped = false;
      if (!this.state) return;
      await this.syncStatusInternal().catch((error) => {
        this.setError(error);
        this.scheduleStatusRetry();
      });
      this.scheduleManagementSync();
    });
  }

  stop(): Promise<void> {
    this.stopped = true;
    this.clearTimers();
    return this.serial(async () => {
      this.tunnel?.stop();
      this.tunnel = null;
      this.externalAccess?.clearCloud();
      if (this.state?.lease) this.connection = "disconnected";
    });
  }

  managementUrl(): Promise<{ url: string; expiresAt: string }> {
    return this.serial(async () => {
      const state = await this.ensureState();
      const current = state.managementSession;
      if (current && Date.parse(current.expiresAt) > Date.now()) {
        return { url: current.managementUrl, expiresAt: current.expiresAt };
      }
      const session = await this.api.createManagementSession(this.identity());
      this.state = {
        ...state,
        managementSession: {
          purchaseToken: session.purchaseToken,
          managementUrl: session.managementUrl,
          expiresAt: session.expiresAt,
        },
      };
      await this.store.save(this.state);
      this.scheduleManagementSync(0);
      return { url: session.managementUrl, expiresAt: session.expiresAt };
    });
  }

  syncStatus(): Promise<CloudStatus> {
    return this.serial(() => this.syncStatusInternal());
  }

  restore(
    recoveryKey: string,
  ): Promise<{ status: CloudStatus; recoveryKey: string }> {
    return this.serial(async () => {
      const state = await this.ensureState();
      const previousEntitlements = state.entitlements;
      const result = await this.api.restore(this.identity(), recoveryKey);
      this.state = {
        ...state,
        customerId: result.customer.id,
        publicPrefix: result.publicPrefix,
        desiredServices: enableNewlyPurchasedServices(
          state.desiredServices,
          previousEntitlements.map((entry) => entry.service),
          result.entitlements.map((entry) => entry.service),
        ),
        entitlements: result.entitlements,
        lease: null,
      };
      await this.store.save(this.state);
      this.tunnel?.stop();
      this.tunnel = null;
      if (!this.stopped) {
        await this.refreshLeaseIfNeeded(true);
        this.connectTunnel();
        this.scheduleRenewal();
      }
      this.lastError = null;
      return { status: this.status(), recoveryKey: result.recoveryKey };
    });
  }

  async replaceRecoveryKey(): Promise<string> {
    await this.ensureState();
    const result = await this.api.replaceRecoveryKey(this.identity());
    return result.recoveryKey;
  }

  setService(service: CloudServiceId, enabled: boolean): Promise<CloudStatus> {
    return this.serial(async () => {
      const state = await this.ensureState();
      if (!CLOUD_SERVICES.includes(service))
        throw new Error(`Unknown Cloud service: ${service}`);
      this.state = {
        ...state,
        desiredServices: { ...state.desiredServices, [service]: enabled },
      };
      await this.store.save(this.state);
      if (!this.stopped) {
        await this.refreshLeaseIfNeeded(true);
        this.connectTunnel();
        this.scheduleRenewal();
      }
      this.lastError = null;
      return this.status();
    });
  }

  private async syncStatusInternal(): Promise<CloudStatus> {
    const state = await this.ensureState();
    const managementSession = this.validManagementSession();
    const previousEntitlements = state.entitlements;
    const previousPrefix = state.publicPrefix;
    const result = await this.api.status(
      this.identity(),
      managementSession?.purchaseToken ?? null,
    );
    this.state = {
      ...state,
      customerId: result.customer?.id ?? null,
      publicPrefix: result.publicPrefix,
      desiredServices: enableNewlyPurchasedServices(
        state.desiredServices,
        previousEntitlements.map((entry) => entry.service),
        result.entitlements.map((entry) => entry.service),
      ),
      entitlements: result.entitlements,
      managementSession: result.managementSessionActive
        ? managementSession
        : null,
    };
    await this.store.save(this.state);
    if (!this.stopped) {
      await this.refreshLeaseIfNeeded(
        previousPrefix !== null && previousPrefix !== result.publicPrefix,
      );
      this.connectTunnel();
      this.scheduleRenewal();
    }
    this.lastError = null;
    if (this.statusRetryTimer) clearTimeout(this.statusRetryTimer);
    this.statusRetryTimer = null;
    return this.status();
  }

  private async refreshLeaseIfNeeded(force: boolean): Promise<void> {
    const state = this.requireState();
    const entitled = new Set(state.entitlements.map((entry) => entry.service));
    const requested = CLOUD_SERVICES.filter(
      (service) => state.desiredServices[service] && entitled.has(service),
    );
    if (requested.length === 0) {
      if (state.lease) {
        this.state = { ...state, lease: null };
        await this.store.save(this.state);
      }
      this.tunnel?.drainAndStop();
      this.tunnel = null;
      this.connection = "inactive";
      this.publishExternalAccess();
      return;
    }
    if (!state.publicPrefix) {
      if (state.lease) {
        this.state = { ...state, lease: null };
        await this.store.save(this.state);
      }
      this.tunnel?.drainAndStop();
      this.tunnel = null;
      this.connection = "inactive";
      this.publishExternalAccess();
      return;
    }
    const current = state.lease;
    const sameServices =
      current &&
      requested.length === current.services.length &&
      requested.every((service) => current.services.includes(service));
    const fresh =
      current && Date.parse(current.expiresAt) - Date.now() > 15 * 60 * 1000;
    if (!force && sameServices && fresh) {
      this.publishExternalAccess();
      return;
    }
    const lease = await this.api.lease(this.identity(), requested);
    this.state = { ...state, lease };
    await this.store.save(this.state);
    this.publishExternalAccess();
    this.tunnel?.updateLease(lease);
  }

  private connectTunnel(): void {
    const state = this.state;
    if (
      this.stopped ||
      this.tunnel ||
      !state?.lease ||
      state.lease.services.length === 0
    )
      return;
    this.connection = "connecting";
    this.tunnel = new CloudTunnelClient(
      state.lease,
      { devicePrivateKey: state.devicePrivateKey },
      this.config.server,
      {
        onConnected: () => {
          this.lastError = null;
          this.connection = "connected";
        },
        onDisconnected: () => {
          if (!this.stopped && this.state?.lease)
            this.connection = "disconnected";
        },
        onError: (error) => this.setError(error),
      },
    );
    this.tunnel.start();
  }

  private publishExternalAccess(): void {
    const state = this.state;
    if (!state) {
      this.externalAccess?.clearCloud();
      return;
    }
    const lease = state.lease;
    const activeLease =
      lease && Date.parse(lease.expiresAt) > Date.now() ? lease : null;
    this.externalAccess?.setCloud({
      mcpBaseUrl: activeLease?.services.includes("remote_mcp")
        ? activeLease.mcpBaseUrl
        : null,
      webBaseUrl: activeLease?.services.includes("remote_web")
        ? activeLease.webBaseUrl
        : null,
    });
  }

  private scheduleStatusRetry(delayMs = 30_000): void {
    if (this.stopped || !this.state || this.statusRetryTimer) return;
    this.statusRetryTimer = setTimeout(() => {
      this.statusRetryTimer = null;
      void this.syncStatus().catch((error) => {
        this.setError(error);
        this.scheduleStatusRetry();
      });
    }, delayMs);
    this.statusRetryTimer.unref();
  }

  private scheduleManagementSync(delayMs = 3_000): void {
    if (this.managementTimer) clearTimeout(this.managementTimer);
    this.managementTimer = null;
    if (this.stopped || !this.validManagementSession()) return;
    this.managementTimer = setTimeout(() => {
      this.managementTimer = null;
      void this.syncStatus()
        .catch((error) => this.setError(error))
        .finally(() => this.scheduleManagementSync());
    }, delayMs);
    this.managementTimer.unref();
  }

  private scheduleRenewal(): void {
    if (this.renewalTimer) clearTimeout(this.renewalTimer);
    this.renewalTimer = null;
    const lease = this.state?.lease;
    if (this.stopped || !lease) return;
    const remaining = Date.parse(lease.expiresAt) - Date.now();
    const delay = Math.max(
      60_000,
      remaining - (10 + Math.random() * 10) * 60_000,
    );
    this.renewalTimer = setTimeout(() => {
      this.renewalTimer = null;
      void this.serial(async () => {
        if (this.stopped) return;
        await this.refreshLeaseIfNeeded(true);
        this.connectTunnel();
      })
        .catch((error) => this.setError(error))
        .finally(() => this.scheduleRenewal());
    }, delay);
    this.renewalTimer.unref();
  }

  private clearTimers(): void {
    if (this.managementTimer) clearTimeout(this.managementTimer);
    if (this.renewalTimer) clearTimeout(this.renewalTimer);
    if (this.statusRetryTimer) clearTimeout(this.statusRetryTimer);
    this.managementTimer = null;
    this.renewalTimer = null;
    this.statusRetryTimer = null;
  }

  private serial<T>(action: () => Promise<T>): Promise<T> {
    const next = this.mutationQueue.then(action, action);
    this.mutationQueue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  private validManagementSession() {
    const value = this.state?.managementSession;
    return value && Date.parse(value.expiresAt) > Date.now() ? value : null;
  }

  private identity() {
    const state = this.requireState();
    return {
      installationId: state.installationId,
      devicePublicKey: state.devicePublicKey,
      devicePrivateKey: state.devicePrivateKey,
    };
  }

  private async ensureState(): Promise<CloudPersistedState> {
    if (this.state) return this.state;
    try {
      this.state = await this.store.loadOrCreate();
      this.lastError = null;
      this.connection = "inactive";
      this.publishExternalAccess();
      return this.state;
    } catch (error) {
      this.externalAccess?.clearCloud();
      const detail = error instanceof Error ? error.message : String(error);
      this.lastError = `Cloud state unavailable: ${detail}`;
      this.connection = "error";
      throw new ChatRoomError(
        "INTERNAL",
        "ChatRoom Cloud is unavailable",
        { reason: "cloud_state_unavailable" },
        error instanceof Error ? { cause: error } : undefined,
      );
    }
  }

  private requireState(): CloudPersistedState {
    if (!this.state)
      throw new ChatRoomError("INTERNAL", "ChatRoom Cloud is unavailable", {
        reason: "cloud_state_unavailable",
      });
    return this.state;
  }

  private setError(error: unknown): void {
    this.lastError = error instanceof Error ? error.message : String(error);
    this.connection = "error";
  }
}

function enableNewlyPurchasedServices(
  desiredServices: Record<CloudServiceId, boolean>,
  previousEntitlements: CloudServiceId[],
  currentEntitlements: CloudServiceId[],
): Record<CloudServiceId, boolean> {
  const previous = new Set(previousEntitlements);
  const current = new Set(currentEntitlements);
  const next = { ...desiredServices };
  for (const service of CLOUD_SERVICES)
    if (!previous.has(service) && current.has(service)) next[service] = true;
  return next;
}
