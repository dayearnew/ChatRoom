import { z } from "zod";

export const CLOUD_SERVICES = ["remote_mcp", "remote_web"] as const;
export const CLOUD_SERVICE_SCHEMA = z.enum(CLOUD_SERVICES);
export type CloudServiceId = (typeof CLOUD_SERVICES)[number];
const PUBLIC_SERVICE_TO_CLOUD_SERVICE = {
  mcp: "remote_mcp",
  web: "remote_web",
} as const satisfies Record<string, CloudServiceId>;
export type PublicService = keyof typeof PUBLIC_SERVICE_TO_CLOUD_SERVICE;
export const CLOUD_DESIRED_SERVICES_SCHEMA = z
  .object({ remote_mcp: z.boolean(), remote_web: z.boolean() })
  .strict();

export function cloudServiceForPublicService(
  service: PublicService,
): CloudServiceId {
  return PUBLIC_SERVICE_TO_CLOUD_SERVICE[service];
}

export const CLOUD_ENTITLEMENT_SCHEMA = z
  .object({
    service: CLOUD_SERVICE_SCHEMA,
    status: z.literal("active"),
    sourceProvider: z.string().min(1),
    sourceId: z.string().min(1),
    validUntil: z.string().datetime().nullable(),
  })
  .strict();
export type CloudEntitlement = z.infer<typeof CLOUD_ENTITLEMENT_SCHEMA>;

export const CLOUD_LEASE_SCHEMA = z
  .object({
    token: z.string().min(1),
    expiresAt: z.string().datetime(),
    tunnelUrl: z.string().url(),
    mcpBaseUrl: z.string().url().nullable(),
    webBaseUrl: z.string().url().nullable(),
    services: z.array(CLOUD_SERVICE_SCHEMA),
  })
  .strict();
export type CloudLeaseState = z.infer<typeof CLOUD_LEASE_SCHEMA>;

interface ManagementSessionState {
  purchaseToken: string;
  managementUrl: string;
  expiresAt: string;
}

export interface CloudPersistedState {
  schemaVersion: 1;
  installationId: string;
  devicePublicKey: string;
  devicePrivateKey: string;
  customerId: string | null;
  publicPrefix: string | null;
  desiredServices: Record<CloudServiceId, boolean>;
  entitlements: CloudEntitlement[];
  managementSession: ManagementSessionState | null;
  lease: CloudLeaseState | null;
}

export interface CloudStatus {
  installationId: string;
  customerId: string | null;
  publicPrefix: string | null;
  desiredServices: Record<CloudServiceId, boolean>;
  entitlements: CloudEntitlement[];
  managementSessionActive: boolean;
  connection:
    "inactive" | "connecting" | "connected" | "disconnected" | "error";
  mcpUrl: string | null;
  webUrl: string | null;
  lastError: string | null;
}
