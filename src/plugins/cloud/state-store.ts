import { generateKeyPairSync, randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  CLOUD_DESIRED_SERVICES_SCHEMA,
  CLOUD_ENTITLEMENT_SCHEMA,
  CLOUD_LEASE_SCHEMA,
  type CloudPersistedState,
} from "./types.js";

const stateSchema = z
  .object({
    schemaVersion: z.literal(1),
    installationId: z.string().uuid(),
    devicePublicKey: z.string().min(20),
    devicePrivateKey: z.string().min(20),
    customerId: z.string().min(1).nullable(),
    publicPrefix: z.string().min(1).nullable(),
    desiredServices: CLOUD_DESIRED_SERVICES_SCHEMA,
    entitlements: z.array(CLOUD_ENTITLEMENT_SCHEMA),
    managementSession: z
      .object({
        purchaseToken: z.string().min(24),
        managementUrl: z.string().url(),
        expiresAt: z.string().datetime(),
      })
      .strict()
      .nullable(),
    lease: CLOUD_LEASE_SCHEMA.nullable(),
  })
  .strict();

export class CloudStateStore {
  readonly filePath: string;

  constructor(dataDir: string) {
    this.filePath = path.join(dataDir, "cloud.json");
  }

  async loadOrCreate(): Promise<CloudPersistedState> {
    try {
      return stateSchema.parse(
        JSON.parse(await readFile(this.filePath, "utf8")),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const state = createInitialState();
    await this.save(state);
    return state;
  }

  async save(state: CloudPersistedState): Promise<void> {
    const validated = stateSchema.parse(state);
    await mkdir(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
    const temporary = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(validated, null, 2)}\n`, {
      mode: 0o600,
    });
    await chmod(temporary, 0o600).catch(() => undefined);
    await rename(temporary, this.filePath);
    await chmod(this.filePath, 0o600).catch(() => undefined);
  }
}

function createInitialState(): CloudPersistedState {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return {
    schemaVersion: 1,
    installationId: randomUUID(),
    devicePublicKey: publicKey
      .export({ format: "der", type: "spki" })
      .toString("base64url"),
    devicePrivateKey: privateKey
      .export({ format: "der", type: "pkcs8" })
      .toString("base64url"),
    customerId: null,
    publicPrefix: null,
    desiredServices: { remote_mcp: true, remote_web: true },
    entitlements: [],
    managementSession: null,
    lease: null,
  };
}
