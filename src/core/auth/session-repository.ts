export interface WebSessionRepository {
  create(tokenHash: string, expiresAt: string): void;
  valid(tokenHash: string, now: string): boolean;
  revoke(tokenHash: string): void;
  prune(now: string): number;
}
