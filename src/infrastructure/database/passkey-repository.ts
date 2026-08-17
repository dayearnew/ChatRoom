import type {
  PasskeyRecord,
  PasskeyRepository as PasskeyRepositoryPort,
} from "../../core/auth/passkey-repository.js";
import type { AppDatabase } from "./app-database.js";

export class PasskeyRepository implements PasskeyRepositoryPort {
  constructor(private readonly database: AppDatabase) {}

  list(): PasskeyRecord[] {
    return this.database.raw
      .prepare(
        "SELECT * FROM passkeys ORDER BY last_used_at DESC, created_at DESC",
      )
      .all()
      .map((row) => mapPasskey(row as unknown as PasskeyRow));
  }

  get(credentialId: string): PasskeyRecord | null {
    const row = this.database.raw
      .prepare("SELECT * FROM passkeys WHERE credential_id=?")
      .get(credentialId) as PasskeyRow | undefined;
    return row ? mapPasskey(row) : null;
  }

  upsert(record: PasskeyRecord): void {
    this.database.raw
      .prepare(
        `INSERT INTO passkeys(
          credential_id, public_key, counter, transports_json, device_type, backed_up,
          name, created_at, last_used_at
        ) VALUES(?,?,?,?,?,?,?,?,?)
        ON CONFLICT(credential_id) DO UPDATE SET
          public_key=excluded.public_key,
          counter=excluded.counter,
          transports_json=excluded.transports_json,
          device_type=excluded.device_type,
          backed_up=excluded.backed_up,
          name=excluded.name,
          last_used_at=excluded.last_used_at`,
      )
      .run(
        record.credentialId,
        Buffer.from(record.publicKey),
        record.counter,
        JSON.stringify(record.transports),
        record.deviceType,
        record.backedUp ? 1 : 0,
        record.name,
        record.createdAt,
        record.lastUsedAt,
      );
  }

  remove(credentialId: string): void {
    this.database.raw
      .prepare("DELETE FROM passkeys WHERE credential_id=?")
      .run(credentialId);
  }

  updateCounter(credentialId: string, counter: number): void {
    this.database.raw
      .prepare(
        "UPDATE passkeys SET counter=?, last_used_at=? WHERE credential_id=?",
      )
      .run(counter, new Date().toISOString(), credentialId);
  }
}

interface PasskeyRow {
  credential_id: string;
  public_key: Uint8Array;
  counter: number;
  transports_json: string;
  device_type: "singleDevice" | "multiDevice";
  backed_up: number;
  name: string;
  created_at: string;
  last_used_at: string;
}

function mapPasskey(row: PasskeyRow): PasskeyRecord {
  return {
    credentialId: row.credential_id,
    publicKey: new Uint8Array(row.public_key),
    counter: row.counter,
    transports: JSON.parse(row.transports_json) as string[],
    deviceType: row.device_type,
    backedUp: Boolean(row.backed_up),
    name: row.name,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
  };
}
