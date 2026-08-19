import { z } from "zod";
import {
  CLOUD_ENTITLEMENT_SCHEMA,
  CLOUD_LEASE_SCHEMA,
  type CloudEntitlement,
  type CloudLeaseState,
  type CloudServiceId,
} from "./types.js";
import { signDeviceProof } from "./device-proof.js";

const customerSchema = z.object({ id: z.string().min(1) }).strict();
const recoveryCredentialSchema = z
  .object({
    recoveryKey: z.string().regex(/^crr\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/),
  })
  .strict();
const sessionSchema = z
  .object({
    purchaseToken: z.string().min(24),
    managementUrl: z.string().url(),
    expiresAt: z.string().datetime(),
  })
  .strict();
const statusSchema = z
  .object({
    managementSessionActive: z.boolean(),
    entitlements: z.array(CLOUD_ENTITLEMENT_SCHEMA),
    customer: customerSchema.nullable(),
    publicPrefix: z.string().min(1).nullable(),
  })
  .strict();
const restoreSchema = z
  .object({
    entitlements: z.array(CLOUD_ENTITLEMENT_SCHEMA),
    customer: customerSchema,
    publicPrefix: z.string().min(1).nullable(),
    recoveryKey: z.string().regex(/^crr\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/),
  })
  .strict();

export class CloudApiClient {
  constructor(private readonly baseUrl: string) {}

  async createManagementSession(
    identity: DeviceIdentity,
  ): Promise<z.infer<typeof sessionSchema>> {
    const payload = { devicePublicKey: identity.devicePublicKey };
    return sessionSchema.parse(
      await this.devicePost("/v1/device/session", "session", identity, payload),
    );
  }

  async status(
    identity: DeviceIdentity,
    purchaseToken: string | null,
  ): Promise<{
    managementSessionActive: boolean;
    entitlements: CloudEntitlement[];
    customer: { id: string } | null;
    publicPrefix: string | null;
  }> {
    const payload = {
      devicePublicKey: identity.devicePublicKey,
      purchaseToken,
    };
    return statusSchema.parse(
      await this.devicePost("/v1/device/status", "status", identity, payload),
    );
  }

  async restore(
    identity: DeviceIdentity,
    recoveryKey: string,
  ): Promise<z.infer<typeof restoreSchema>> {
    const payload = { devicePublicKey: identity.devicePublicKey, recoveryKey };
    return restoreSchema.parse(
      await this.devicePost("/v1/device/restore", "restore", identity, payload),
    );
  }

  async replaceRecoveryKey(
    identity: DeviceIdentity,
  ): Promise<z.infer<typeof recoveryCredentialSchema>> {
    const payload = { devicePublicKey: identity.devicePublicKey };
    return recoveryCredentialSchema.parse(
      await this.devicePost(
        "/v1/device/recovery-key",
        "recovery-key",
        identity,
        payload,
      ),
    );
  }

  async lease(
    identity: DeviceIdentity,
    requestedServices: CloudServiceId[],
  ): Promise<CloudLeaseState> {
    const payload = {
      devicePublicKey: identity.devicePublicKey,
      requestedServices,
    };
    return CLOUD_LEASE_SCHEMA.parse(
      await this.devicePost("/v1/device/lease", "lease", identity, payload),
    );
  }

  private async devicePost(
    path: string,
    operation: string,
    identity: DeviceIdentity,
    payload: Record<string, unknown>,
  ): Promise<unknown> {
    const proof = signDeviceProof({
      operation,
      installationId: identity.installationId,
      devicePrivateKey: identity.devicePrivateKey,
      payload,
    });
    const response = await fetch(new URL(path, `${this.baseUrl}/`), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({
        installationId: identity.installationId,
        ...payload,
        ...proof,
      }),
    });
    const body = (await response.json().catch(() => null)) as unknown;
    if (!response.ok) {
      const message =
        typeof body === "object" &&
        body &&
        "message" in body &&
        typeof body.message === "string"
          ? body.message
          : `ChatRoom Cloud request failed (${response.status})`;
      const issues =
        typeof body === "object" &&
        body &&
        "issues" in body &&
        Array.isArray(body.issues)
          ? body.issues.flatMap((issue) => {
              if (!issue || typeof issue !== "object") return [];
              const path =
                "path" in issue && Array.isArray(issue.path)
                  ? issue.path.join(".")
                  : "";
              const detail =
                "message" in issue && typeof issue.message === "string"
                  ? issue.message
                  : "";
              return detail ? [`${path || "request"}: ${detail}`] : [];
            })
          : [];
      throw new Error(
        issues.length ? `${message}: ${issues.join("; ")}` : message,
      );
    }
    return body;
  }
}

export interface DeviceIdentity {
  installationId: string;
  devicePublicKey: string;
  devicePrivateKey: string;
}
