import type { ChatRoomConfig } from "../../config/types.js";
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
  private state!: CloudPersistedState;
  private tunnel: CloudTunnelClient | null = null;
  private connection: CloudStatus["connection"] = "inactive";
  private lastError: string | null = null;
  private managementTimer: NodeJS.Timeout | null = null;
  private renewalTimer: NodeJS.Timeout | null = null;
  private stopped = true;

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
    controller.state = await controller.store.loadOrCreate();
    controller.publishExternalAccess();
    return controller;
  }

  status(): CloudStatus {
    return {
      installationId: this.state.installationId,
      customerId: this.state.customerId,
      publicPrefix: this.state.publicPrefix,
      desiredServices: { ...this.state.desiredServices },
      entitlements: [...this.state.entitlements],
      managementSessionActive: Boolean(
        this.state.managementSession &&
        Date.parse(this.state.managementSession.expiresAt) > Date.now(),
      ),
      connection: this.connection,
      mcpUrl: this.state.lease?.mcpBaseUrl
        ? `${this.state.lease.mcpBaseUrl}/mcp`
        : null,
      webUrl: this.state.lease?.webBaseUrl ?? null,
      lastError: this.lastError,
    };
  }

  async start(): Promise<void> {
    if (!this.stopped) return;
    this.stopped = false;
    await this.syncStatus().catch((error) => this.setError(error));
    this.scheduleManagementSync();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.managementTimer) clearTimeout(this.managementTimer);
    if (this.renewalTimer) clearTimeout(this.renewalTimer);
    this.managementTimer = null;
    this.renewalTimer = null;
    this.tunnel?.stop();
    this.tunnel = null;
    this.externalAccess?.clearCloud();
    if (this.state.lease) this.connection = "disconnected";
  }

  async managementUrl(): Promise<{ url: string; expiresAt: string }> {
    const current = this.state.managementSession;
    if (current && Date.parse(current.expiresAt) > Date.now()) {
      return { url: current.managementUrl, expiresAt: current.expiresAt };
    }
    const session = await this.api.createManagementSession(this.identity());
    this.state = {
      ...this.state,
      managementSession: {
        purchaseToken: session.purchaseToken,
        managementUrl: session.managementUrl,
        expiresAt: session.expiresAt,
      },
    };
    await this.store.save(this.state);
    this.scheduleManagementSync(0);
    return { url: session.managementUrl, expiresAt: session.expiresAt };
  }

  async syncStatus(): Promise<CloudStatus> {
    const managementSession = this.validManagementSession();
    const previousEntitlements = this.state.entitlements;
    const previousPrefix = this.state.publicPrefix;
    const result = await this.api.status(
      this.identity(),
      managementSession?.purchaseToken ?? null,
    );
    const nextCustomerId = result.customer?.id ?? null;
    this.state = {
      ...this.state,
      customerId: nextCustomerId,
      publicPrefix: result.publicPrefix,
      desiredServices: enableNewlyPurchasedServices(
        this.state.desiredServices,
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
    return this.status();
  }

  async restore(
    recoveryKey: string,
  ): Promise<{ status: CloudStatus; recoveryKey: string }> {
    const previousEntitlements = this.state.entitlements;
    const result = await this.api.restore(this.identity(), recoveryKey);
    this.state = {
      ...this.state,
      customerId: result.customer.id,
      publicPrefix: result.publicPrefix,
      desiredServices: enableNewlyPurchasedServices(
        this.state.desiredServices,
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
  }

  async replaceRecoveryKey(): Promise<string> {
    const result = await this.api.replaceRecoveryKey(this.identity());
    return result.recoveryKey;
  }

  async setService(
    service: CloudServiceId,
    enabled: boolean,
  ): Promise<CloudStatus> {
    if (!CLOUD_SERVICES.includes(service))
      throw new Error(`Unknown Cloud service: ${service}`);
    this.state = {
      ...this.state,
      desiredServices: { ...this.state.desiredServices, [service]: enabled },
    };
    await this.store.save(this.state);
    if (!this.stopped) {
      await this.refreshLeaseIfNeeded(true);
      this.connectTunnel();
      this.scheduleRenewal();
    }
    this.lastError = null;
    return this.status();
  }

  private async refreshLeaseIfNeeded(force: boolean): Promise<void> {
    const entitled = new Set(
      this.state.entitlements.map((entry) => entry.service),
    );
    const requested = CLOUD_SERVICES.filter(
      (service) => this.state.desiredServices[service] && entitled.has(service),
    );
    if (requested.length === 0) {
      if (this.state.lease) {
        this.state = { ...this.state, lease: null };
        await this.store.save(this.state);
      }
      this.tunnel?.drainAndStop();
      this.tunnel = null;
      this.connection = "inactive";
      this.publishExternalAccess();
      return;
    }
    if (!this.state.publicPrefix) {
      if (this.state.lease) {
        this.state = { ...this.state, lease: null };
        await this.store.save(this.state);
      }
      this.tunnel?.drainAndStop();
      this.tunnel = null;
      this.connection = "inactive";
      this.publishExternalAccess();
      return;
    }
    const current = this.state.lease;
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
    this.state = { ...this.state, lease };
    await this.store.save(this.state);
    this.publishExternalAccess();
    this.tunnel?.updateLease(lease);
  }

  private connectTunnel(): void {
    if (
      this.stopped ||
      this.tunnel ||
      !this.state.lease ||
      this.state.lease.services.length === 0
    )
      return;
    this.connection = "connecting";
    this.tunnel = new CloudTunnelClient(
      this.state.lease,
      { devicePrivateKey: this.state.devicePrivateKey },
      this.config.server,
      {
        onConnected: () => {
          this.lastError = null;
          this.connection = "connected";
        },
        onDisconnected: () => {
          if (!this.stopped && this.state.lease)
            this.connection = "disconnected";
        },
        onError: (error) => this.setError(error),
      },
    );
    this.tunnel.start();
  }

  private publishExternalAccess(): void {
    const lease = this.state.lease;
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
    const lease = this.state.lease;
    if (this.stopped || !lease) return;
    const remaining = Date.parse(lease.expiresAt) - Date.now();
    const delay = Math.max(
      60_000,
      remaining - (10 + Math.random() * 10) * 60_000,
    );
    this.renewalTimer = setTimeout(() => {
      this.renewalTimer = null;
      void this.refreshLeaseIfNeeded(true)
        .then(() => this.connectTunnel())
        .catch((error) => this.setError(error))
        .finally(() => this.scheduleRenewal());
    }, delay);
    this.renewalTimer.unref();
  }

  private validManagementSession() {
    const value = this.state.managementSession;
    return value && Date.parse(value.expiresAt) > Date.now() ? value : null;
  }

  private identity() {
    return {
      installationId: this.state.installationId,
      devicePublicKey: this.state.devicePublicKey,
      devicePrivateKey: this.state.devicePrivateKey,
    };
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
