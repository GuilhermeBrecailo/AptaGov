import { copyFileSync, mkdirSync, renameSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SqliteDatabase } from '../db/database';

export function createDatabaseBackup(db: SqliteDatabase, databaseUrl: string, backupDirectory = './backups'): string {
  const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  const databasePath = resolve(projectRoot, databaseUrl);
  const targetDirectory = resolve(projectRoot, backupDirectory);
  mkdirSync(targetDirectory, { recursive: true });
  if (databaseUrl === ':memory:') throw new Error('Cannot back up an in-memory database');
  db.pragma('wal_checkpoint(TRUNCATE)');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const destination = resolve(targetDirectory, `licitacoes-${stamp}.db`);
  const temporary = `${destination}.tmp`;
  copyFileSync(databasePath, temporary);
  renameSync(temporary, destination);
  return destination;
}
