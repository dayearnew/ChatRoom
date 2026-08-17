export interface PasskeyRecord {
  credentialId: string;
  publicKey: Uint8Array;
  counter: number;
  transports: string[];
  deviceType: "singleDevice" | "multiDevice";
  backedUp: boolean;
  name: string;
  createdAt: string;
  lastUsedAt: string;
}

export interface PasskeyRepository {
  list(): PasskeyRecord[];
  get(credentialId: string): PasskeyRecord | null;
  upsert(record: PasskeyRecord): void;
  remove(credentialId: string): void;
  updateCounter(credentialId: string, counter: number): void;
}
