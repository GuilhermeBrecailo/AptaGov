import { createHash, randomBytes } from 'node:crypto';
import type { SqliteDatabase } from '../db/database';

export class SessionRepository {
  constructor(private readonly db: SqliteDatabase) {}

  create(userId: number, expiresAt: Date): string {
    const token = randomBytes(32).toString('base64url');
    this.db.prepare('INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)')
      .run(hashToken(token), userId, expiresAt.toISOString(), new Date().toISOString());
    return token;
  }

  findUserId(token: string): number | undefined {
    const row = this.db.prepare('SELECT user_id FROM sessions WHERE id = ? AND expires_at > ?').get(hashToken(token), new Date().toISOString()) as { user_id: number } | undefined;
    return row?.user_id;
  }

  revoke(token: string): void {
    this.db.prepare('DELETE FROM sessions WHERE id = ?').run(hashToken(token));
  }
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
