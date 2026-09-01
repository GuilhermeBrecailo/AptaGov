import type { SqliteDatabase } from '../db/database';

export interface User {
  id: number;
  name: string;
  email: string;
  passwordHash: string;
}

export interface UserInput {
  name: string;
  email: string;
  passwordHash: string;
}

export class UserRepository {
  constructor(private readonly db: SqliteDatabase) {}

  create(input: UserInput): User {
    const now = new Date().toISOString();
    const result = this.db.prepare(`
      INSERT INTO users (name, email, password_hash, created_at, updated_at)
      VALUES (@name, @email, @passwordHash, @now, @now)
    `).run({ ...input, email: normalizeEmail(input.email), now });
    return this.findById(Number(result.lastInsertRowid)) as User;
  }

  findById(id: number): User | undefined {
    const row = this.db.prepare('SELECT id, name, email, password_hash FROM users WHERE id = ?').get(id) as UserRow | undefined;
    return row ? mapRow(row) : undefined;
  }

  findByEmail(email: string): User | undefined {
    const row = this.db.prepare('SELECT id, name, email, password_hash FROM users WHERE email = ? COLLATE NOCASE').get(normalizeEmail(email)) as UserRow | undefined;
    return row ? mapRow(row) : undefined;
  }
}

type UserRow = { id: number; name: string; email: string; password_hash: string };

function mapRow(row: UserRow): User {
  return { id: row.id, name: row.name, email: row.email, passwordHash: row.password_hash };
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
