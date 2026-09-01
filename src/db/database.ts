import Database from 'better-sqlite3';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export type SqliteDatabase = Database.Database;

const rootDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

export function createDatabase(databaseUrl: string): SqliteDatabase {
  const filename = databaseUrl === ':memory:' ? databaseUrl : resolve(rootDirectory, databaseUrl);
  if (filename !== ':memory:') {
    mkdirSync(dirname(filename), { recursive: true });
  }
  const db = new Database(filename);
  db.pragma('foreign_keys = ON');
  if (filename !== ':memory:') {
    db.pragma('journal_mode = WAL');
  }
  migrateDatabase(db);
  return db;
}

export function createTestDatabase(): SqliteDatabase {
  return createDatabase(':memory:');
}

export function migrateDatabase(db: SqliteDatabase): void {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
  const migrations = ['001_initial', '002_saas_auth_and_kanban', '003_email_notifications', '004_push_notifications', '005_billing', '006_organization_scoring', '007_opportunity_source', '008_billing_plan_codes', '009_organization_sync_settings', '010_saved_searches_and_onboarding', '011_opportunity_feedback', '012_notification_events', '013_push_notification_events', '014_radar_notification_preferences', '015_agenda_and_opportunity_changes', '016_opportunity_change_reads'];
  for (const version of migrations) {
    const alreadyApplied = db.prepare('SELECT 1 FROM schema_migrations WHERE version = ?').get(version);
    if (alreadyApplied) continue;
    const migrationPath = resolve(rootDirectory, `migrations/${version}.sql`);
    const migration = readFileSync(migrationPath, 'utf8');
    const apply = db.transaction(() => {
      db.exec(migration);
      db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(version, new Date().toISOString());
    });
    apply();
  }
}
