import Database from 'better-sqlite3';
import { copyFileSync, mkdirSync, renameSync, statSync } from 'node:fs';
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
  if (!validateDatabaseBackupArtifact(destination)) throw new Error('Backup artifact integrity check failed');
  return destination;
}

export function validateDatabaseBackupArtifact(path: string): boolean {
  let backup: Database.Database | undefined;
  try {
    const stats = statSync(path);
    if (!stats.isFile() || stats.size === 0) return false;
    backup = new Database(path, { readonly: true, fileMustExist: true });
    const result = backup.prepare('PRAGMA integrity_check').get() as { integrity_check?: unknown };
    return result.integrity_check === 'ok';
  } catch {
    return false;
  } finally {
    backup?.close();
  }
}
