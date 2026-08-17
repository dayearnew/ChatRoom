import type { WebSessionRepository as WebSessionRepositoryPort } from "../../core/auth/session-repository.js";
import type { AppDatabase } from "./app-database.js";

export class WebSessionRepository implements WebSessionRepositoryPort {
  constructor(private readonly database: AppDatabase) {}

  create(tokenHash: string, expiresAt: string): void {
    this.database.raw
      .prepare(
        "INSERT INTO web_sessions(token_hash,expires_at,created_at) VALUES(?,?,?)",
      )
      .run(tokenHash, expiresAt, new Date().toISOString());
  }

  valid(tokenHash: string, now: string): boolean {
    return Boolean(
      this.database.raw
        .prepare(
          "SELECT 1 AS ok FROM web_sessions WHERE token_hash=? AND expires_at > ?",
        )
        .get(tokenHash, now),
    );
  }

  revoke(tokenHash: string): void {
    this.database.raw
      .prepare("DELETE FROM web_sessions WHERE token_hash=?")
      .run(tokenHash);
  }

  prune(now: string): number {
    return Number(
      this.database.raw
        .prepare("DELETE FROM web_sessions WHERE expires_at <= ?")
        .run(now).changes,
    );
  }
}
