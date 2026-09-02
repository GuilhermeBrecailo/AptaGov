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
  const migrations = ['001_initial', '002_saas_auth_and_kanban', '003_email_notifications', '004_push_notifications', '005_billing', '006_organization_scoring', '007_opportunity_source', '008_billing_plan_codes', '009_organization_sync_settings', '010_saved_searches_and_onboarding', '011_opportunity_feedback', '012_notification_events', '013_push_notification_events', '014_radar_notification_preferences', '015_agenda_and_opportunity_changes', '016_opportunity_change_reads', '017_opportunity_checklists', '018_opportunity_change_types', '019_organization_alert_preferences', '019_1_organization_change_alert_preference', '020_market_intelligence', '021_source_checkpoints', '022_market_results_contract', '023_durable_worker_hardening', '024_worker_outbox', '025_worker_pauses', '026_worker_cycle_metrics', '027_durable_worker_followup', '028_legacy_job_scope', '029_worker_delivery_leases'];
  for (const version of migrations) {
    const alreadyApplied = db.prepare('SELECT 1 FROM schema_migrations WHERE version = ?').get(version);
    if (alreadyApplied) continue;
    const migrationPath = resolve(rootDirectory, `migrations/${version}.sql`);
    const migration = readFileSync(migrationPath, 'utf8');
    const apply = db.transaction(() => {
      if (version === '022_market_results_contract') {
        applyMarketResultsContractUpgrade(db, migration);
      } else {
        db.exec(migration);
      }
      db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(version, new Date().toISOString());
    });
    apply();
  }
}

function applyMarketResultsContractUpgrade(db: SqliteDatabase, postUpgradeSql: string): void {
  const table = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'market_results'").get();
  if (!table) throw new Error('Cannot apply market_results contract: table does not exist');

  const columns = new Set((db.prepare("PRAGMA table_info('market_results')").all() as Array<{ name: string }>).map((column) => column.name));
  const missingColumns: Array<[string, string]> = [
    ['normalized_description', "ALTER TABLE market_results ADD COLUMN normalized_description TEXT NOT NULL DEFAULT ''"],
    ['unit', "ALTER TABLE market_results ADD COLUMN unit TEXT NOT NULL DEFAULT ''"],
    ['quantity', "ALTER TABLE market_results ADD COLUMN quantity REAL NOT NULL DEFAULT 0"],
    ['unit_price_cents', 'ALTER TABLE market_results ADD COLUMN unit_price_cents INTEGER'],
    ['total_price_cents', 'ALTER TABLE market_results ADD COLUMN total_price_cents INTEGER'],
    ['organization', "ALTER TABLE market_results ADD COLUMN organization TEXT NOT NULL DEFAULT ''"],
    ['state', "ALTER TABLE market_results ADD COLUMN state TEXT NOT NULL DEFAULT ''"],
    ['opportunity_id', 'ALTER TABLE market_results ADD COLUMN opportunity_id INTEGER REFERENCES opportunities(id) ON DELETE SET NULL'],
  ];
  for (const [column, statement] of missingColumns) {
    if (!columns.has(column)) db.exec(statement);
  }
  db.exec(postUpgradeSql);
}
