import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createTestDatabase, migrateDatabase } from '../../src/db/database';

const root = resolve(process.cwd());
const priorVersions = [
  '001_initial', '002_saas_auth_and_kanban', '003_email_notifications', '004_push_notifications',
  '005_billing', '006_organization_scoring', '007_opportunity_source', '008_billing_plan_codes',
  '009_organization_sync_settings', '010_saved_searches_and_onboarding', '011_opportunity_feedback',
  '012_notification_events', '013_push_notification_events', '014_radar_notification_preferences',
  '015_agenda_and_opportunity_changes', '016_opportunity_change_reads', '017_opportunity_checklists',
  '018_opportunity_change_types', '019_organization_alert_preferences', '019_1_organization_change_alert_preference',
];

function applyLegacyHistory(db: Database.Database): void {
  db.exec('CREATE TABLE schema_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
  for (const version of priorVersions) {
    db.exec(readFileSync(resolve(root, `migrations/${version}.sql`), 'utf8'));
    db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(version, '2026-09-01T00:00:00.000Z');
  }
  db.exec(`
    ALTER TABLE opportunities ADD COLUMN source_code TEXT NOT NULL DEFAULT 'PNCP'
      CHECK (source_code IN ('PNCP', 'OPEN_DATA', 'BEC/SP'));
    CREATE TABLE market_observations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_code TEXT NOT NULL,
      external_id TEXT NOT NULL,
      item_code TEXT NOT NULL DEFAULT '',
      normalized_description TEXT NOT NULL,
      unit TEXT NOT NULL,
      quantity REAL NOT NULL,
      unit_price_cents INTEGER,
      total_price_cents INTEGER,
      organization TEXT NOT NULL DEFAULT '',
      state TEXT NOT NULL DEFAULT '',
      observed_at TEXT NOT NULL,
      opportunity_id INTEGER,
      source_url TEXT NOT NULL,
      raw_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (source_code, external_id, item_code)
    );
    CREATE TABLE market_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_code TEXT NOT NULL CHECK (source_code IN ('PNCP', 'OPEN_DATA', 'BEC/SP')),
      external_id TEXT NOT NULL,
      item_code TEXT NOT NULL DEFAULT '',
      winner TEXT,
      awarded_price_cents INTEGER,
      status TEXT,
      observed_at TEXT NOT NULL,
      source_url TEXT NOT NULL,
      raw_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (source_code, external_id, item_code)
    );
    CREATE TABLE source_checkpoints (
      source_code TEXT NOT NULL,
      window_start TEXT NOT NULL,
      window_end TEXT NOT NULL,
      cursor TEXT,
      status TEXT NOT NULL,
      received_count INTEGER NOT NULL DEFAULT 0,
      persisted_count INTEGER NOT NULL DEFAULT 0,
      created_count INTEGER NOT NULL DEFAULT 0,
      updated_count INTEGER NOT NULL DEFAULT 0,
      error_category TEXT,
      last_success_at TEXT,
      next_retry_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (source_code, window_start, window_end)
    );
    CREATE TABLE source_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_code TEXT NOT NULL,
      window_start TEXT NOT NULL,
      window_end TEXT NOT NULL,
      cursor TEXT,
      status TEXT NOT NULL,
      received_count INTEGER NOT NULL DEFAULT 0,
      persisted_count INTEGER NOT NULL DEFAULT 0,
      created_count INTEGER NOT NULL DEFAULT 0,
      updated_count INTEGER NOT NULL DEFAULT 0,
      error_category TEXT,
      error_message TEXT,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  db.prepare(`
    INSERT INTO market_results (
      source_code, external_id, item_code, winner, awarded_price_cents, status,
      observed_at, source_url, raw_json, created_at, updated_at
    ) VALUES ('BEC/SP', 'legacy-oc', 'legacy-item', 'Fornecedor legado', 12300, 'AWARDED',
      '2026-08-31T10:00:00.000Z', 'https://bec.example/legacy', '{"legacy":true}',
      '2026-08-31T10:00:00.000Z', '2026-08-31T10:00:00.000Z')
  `).run();
  db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run('020_market_intelligence', '2026-09-01T00:00:00.000Z');
  db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run('021_source_checkpoints', '2026-09-01T00:00:00.000Z');
}

function marketResultColumns(db: Database.Database): string[] {
  return (db.prepare("PRAGMA table_info('market_results')").all() as Array<{ name: string }>).map((column) => column.name);
}

describe('upgrade da migration de resultados de mercado', () => {
  it('leva banco com 020/021 aplicadas ao mesmo schema do banco fresco e preserva dados', () => {
    const legacy = new Database(':memory:');
    legacy.pragma('foreign_keys = ON');
    applyLegacyHistory(legacy);
    migrateDatabase(legacy);
    expect(() => migrateDatabase(legacy)).not.toThrow();

    const fresh = createTestDatabase();
    const expectedColumns = [
      'source_code', 'external_id', 'item_code', 'normalized_description', 'unit', 'quantity',
      'unit_price_cents', 'total_price_cents', 'organization', 'state', 'opportunity_id',
      'winner', 'awarded_price_cents', 'status', 'observed_at', 'source_url', 'raw_json',
    ];
    expect(marketResultColumns(legacy)).toEqual(expect.arrayContaining(expectedColumns));
    expect(marketResultColumns(legacy)).toEqual(marketResultColumns(fresh));
    expect(legacy.prepare('SELECT * FROM market_results WHERE external_id = ?').get('legacy-oc')).toMatchObject({
      source_code: 'BEC/SP',
      external_id: 'legacy-oc',
      item_code: 'legacy-item',
      winner: 'Fornecedor legado',
      awarded_price_cents: 12300,
      normalized_description: '',
      unit: '',
      quantity: 0,
      organization: '',
      state: '',
      source_url: 'https://bec.example/legacy',
    });
    const indexNames = (db: Database.Database) => (db.prepare("PRAGMA index_list('market_results')").all() as Array<{ name: string }>).map((index) => index.name);
    expect(indexNames(legacy)).toEqual(expect.arrayContaining([
      'idx_market_results_source_date',
      'idx_market_results_item_date',
      'idx_market_results_description_date',
      'idx_market_results_organization_state',
    ]));
    expect(indexNames(legacy)).toEqual(indexNames(fresh));
  });
});
