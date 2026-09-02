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

function applyBaseHistory(db: Database.Database): void {
  db.exec('CREATE TABLE schema_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
  for (const version of priorVersions) {
    db.exec(readFileSync(resolve(root, `migrations/${version}.sql`), 'utf8'));
    db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(version, '2026-09-01T00:00:00.000Z');
  }

  db.exec(readFileSync(resolve(root, 'migrations/020_market_intelligence.sql'), 'utf8'));
  db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run('020_market_intelligence', '2026-09-01T00:00:00.000Z');
  db.exec(readFileSync(resolve(root, 'migrations/021_source_checkpoints.sql'), 'utf8'));
  db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run('021_source_checkpoints', '2026-09-01T00:00:00.000Z');

  db.prepare(`
    INSERT INTO market_results (
      source_code, external_id, item_code, normalized_description, unit, quantity,
      unit_price_cents, total_price_cents, organization, state, opportunity_id,
      winner, awarded_price_cents, status, observed_at, source_url, raw_json, created_at, updated_at
    ) VALUES ('BEC/SP', 'legacy-oc', 'legacy-item', 'descricao legada', 'UNIDADE', 2,
      6150, 12300, 'Órgão legado', 'SP', NULL, 'Fornecedor legado', 12300, 'AWARDED',
      '2026-08-31T10:00:00.000Z', 'https://bec.example/legacy', '{"legacy":true}',
      '2026-08-31T10:00:00.000Z', '2026-08-31T10:00:00.000Z')
  `).run();
}

function marketResultColumns(db: Database.Database): string[] {
  return (db.prepare("PRAGMA table_info('market_results')").all() as Array<{ name: string }>).map((column) => column.name);
}

function marketResultIndexes(db: Database.Database): string[] {
  return (db.prepare("PRAGMA index_list('market_results')").all() as Array<{ name: string }>).map((index) => index.name);
}

describe('upgrade da migration de resultados de mercado', () => {
  it('atualiza schema completo de 020 do BASE sem ADD duplicado, preserva dados e e idempotente', () => {
    const legacy = new Database(':memory:');
    legacy.pragma('foreign_keys = ON');
    const base020 = readFileSync(resolve(root, 'migrations/020_market_intelligence.sql'), 'utf8');
    expect(base020).toContain('normalized_description TEXT NOT NULL');
    expect(base020).toContain('idx_market_results_description_date');
    applyBaseHistory(legacy);

    expect(() => migrateDatabase(legacy)).not.toThrow();
    expect(() => migrateDatabase(legacy)).not.toThrow();

    const fresh = createTestDatabase();
    const expectedColumns = [
      'source_code', 'external_id', 'item_code', 'normalized_description', 'unit', 'quantity',
      'unit_price_cents', 'total_price_cents', 'organization', 'state', 'opportunity_id',
      'winner', 'awarded_price_cents', 'status', 'observed_at', 'source_url', 'raw_json',
    ];
    expect(marketResultColumns(legacy)).toEqual(expect.arrayContaining(expectedColumns));
    expect(marketResultColumns(legacy)).toEqual(marketResultColumns(fresh));
    expect(marketResultIndexes(legacy)).toEqual(marketResultIndexes(fresh));
    expect(legacy.prepare('SELECT * FROM market_results WHERE external_id = ?').get('legacy-oc')).toMatchObject({
      source_code: 'BEC/SP',
      external_id: 'legacy-oc',
      item_code: 'legacy-item',
      normalized_description: 'descricao legada',
      unit: 'UNIDADE',
      quantity: 2,
      unit_price_cents: 6150,
      total_price_cents: 12300,
      organization: 'Órgão legado',
      state: 'SP',
      winner: 'Fornecedor legado',
      awarded_price_cents: 12300,
      source_url: 'https://bec.example/legacy',
    });
    expect(legacy.prepare('SELECT version FROM schema_migrations WHERE version = ?').get('022_market_results_contract')).toBeTruthy();
  });
});
