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
  migrations.push('030_source_checkpoint_compatibility', '031_source_checkpoint_rollout_repair');
  for (const version of migrations) {
    const alreadyApplied = db.prepare('SELECT 1 FROM schema_migrations WHERE version = ?').get(version);
    if (alreadyApplied) continue;
    const migrationPath = resolve(rootDirectory, `migrations/${version}.sql`);
    const migration = readFileSync(migrationPath, 'utf8');
    const apply = db.transaction(() => {
      if (version === '022_market_results_contract') {
        applyMarketResultsContractUpgrade(db, migration);
      } else if (version === '031_source_checkpoint_rollout_repair') {
        applyCheckpointRolloutRepair(db);
      } else {
        db.exec(migration);
      }
      db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(version, new Date().toISOString());
    });
    apply();
  }
}

function applyCheckpointRolloutRepair(db: SqliteDatabase): void {
  const sourceColumns = tableColumns(db, 'source_checkpoints');
  if (sourceColumns.has('flow') && sourceColumns.has('scope_key')) {
    return;
  }

  const swappedColumns = tableColumns(db, 'source_checkpoints_scoped');
  if (!sourceColumns.has('cursor') || !swappedColumns.has('flow') || !swappedColumns.has('scope_key')) {
    throw new Error('Cannot repair source checkpoint rollout: expected scoped and legacy tables are missing');
  }

  const temporaryLegacyTable = 'source_checkpoints_030_legacy';
  if (tableExists(db, temporaryLegacyTable)) throw new Error('Cannot repair source checkpoint rollout: temporary table already exists');
  db.exec(`ALTER TABLE source_checkpoints RENAME TO ${temporaryLegacyTable}`);
  db.exec('ALTER TABLE source_checkpoints_scoped RENAME TO source_checkpoints');

  const legacyRows = db.prepare(`
    SELECT source_code, window_start, window_end, cursor, status,
      received_count, persisted_count, created_count, updated_count, error_category,
      last_success_at, next_retry_at, created_at, updated_at
    FROM ${temporaryLegacyTable}
  `).all() as LegacyCheckpointRow[];
  const mergeLegacyProgress = db.prepare(`
    INSERT INTO source_checkpoints (
      source_code, flow, scope_key, window_start, window_end, cursor, status,
      received_count, persisted_count, created_count, updated_count, error_category,
      last_success_at, next_retry_at, created_at, updated_at
    ) VALUES (?, 'opportunity', 'default', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(source_code, flow, scope_key, window_start, window_end) DO UPDATE SET
      cursor = CASE WHEN excluded.updated_at > source_checkpoints.updated_at THEN excluded.cursor ELSE source_checkpoints.cursor END,
      status = CASE WHEN excluded.updated_at > source_checkpoints.updated_at THEN excluded.status ELSE source_checkpoints.status END,
      received_count = CASE WHEN excluded.updated_at > source_checkpoints.updated_at THEN excluded.received_count ELSE source_checkpoints.received_count END,
      persisted_count = CASE WHEN excluded.updated_at > source_checkpoints.updated_at THEN excluded.persisted_count ELSE source_checkpoints.persisted_count END,
      created_count = CASE WHEN excluded.updated_at > source_checkpoints.updated_at THEN excluded.created_count ELSE source_checkpoints.created_count END,
      updated_count = CASE WHEN excluded.updated_at > source_checkpoints.updated_at THEN excluded.updated_count ELSE source_checkpoints.updated_count END,
      error_category = CASE WHEN excluded.updated_at > source_checkpoints.updated_at THEN excluded.error_category ELSE source_checkpoints.error_category END,
      last_success_at = CASE WHEN excluded.updated_at > source_checkpoints.updated_at THEN excluded.last_success_at ELSE source_checkpoints.last_success_at END,
      next_retry_at = CASE WHEN excluded.updated_at > source_checkpoints.updated_at THEN excluded.next_retry_at ELSE source_checkpoints.next_retry_at END,
      updated_at = CASE WHEN excluded.updated_at > source_checkpoints.updated_at THEN excluded.updated_at ELSE source_checkpoints.updated_at END
  `);
  for (const row of legacyRows) {
    mergeLegacyProgress.run(
      row.source_code,
      row.window_start,
      row.window_end,
      row.cursor,
      row.status,
      row.received_count,
      row.persisted_count,
      row.created_count,
      row.updated_count,
      row.error_category,
      row.last_success_at,
      row.next_retry_at,
      row.created_at,
      row.updated_at,
    );
  }

  if (tableExists(db, 'source_checkpoints_legacy')) {
    db.prepare(`
      INSERT OR REPLACE INTO source_checkpoints_legacy (
        source_code, window_start, window_end, cursor, status,
        received_count, persisted_count, created_count, updated_count, error_category,
        last_success_at, next_retry_at, created_at, updated_at
      ) SELECT source_code, window_start, window_end, cursor, status,
        received_count, persisted_count, created_count, updated_count, error_category,
        last_success_at, next_retry_at, created_at, updated_at
      FROM ${temporaryLegacyTable}
    `).run();
    db.exec(`DROP TABLE ${temporaryLegacyTable}`);
  } else {
    db.exec(`ALTER TABLE ${temporaryLegacyTable} RENAME TO source_checkpoints_legacy`);
  }
}

function tableExists(db: SqliteDatabase, table: string): boolean {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table));
}

function tableColumns(db: SqliteDatabase, table: string): Set<string> {
  return new Set((db.prepare(`PRAGMA table_info('${table}')`).all() as Array<{ name: string }>).map((column) => column.name));
}

interface LegacyCheckpointRow {
  source_code: string;
  window_start: string;
  window_end: string;
  cursor: string | null;
  status: string;
  received_count: number;
  persisted_count: number;
  created_count: number;
  updated_count: number;
  error_category: string | null;
  last_success_at: string | null;
  next_retry_at: string | null;
  created_at: string;
  updated_at: string;
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
