import { describe, expect, it } from 'vitest';
import { createTestDatabase, migrateDatabase } from '../../src/db/database';
import { SourceSyncRepository } from '../../src/repositories/sourceSyncRepository';

const window = { dateFrom: '2026-08-28', dateTo: '2026-08-31' };

function columns(db: ReturnType<typeof createTestDatabase>, table: string): string[] {
  return (db.prepare(`PRAGMA table_info('${table}')`).all() as Array<{ name: string }>).map((row) => row.name);
}

function normalizeToPrevious030State(db: ReturnType<typeof createTestDatabase>): void {
  if (columns(db, 'source_checkpoints').includes('flow')) {
    db.exec('ALTER TABLE source_checkpoints RENAME TO source_checkpoints_scoped_sim');
    db.exec('ALTER TABLE source_checkpoints_legacy RENAME TO source_checkpoints');
    db.exec('ALTER TABLE source_checkpoints_scoped_sim RENAME TO source_checkpoints_scoped');
  }
}

describe('Task 7: rollout e rollback do checkpoint scoped', () => {
  it('fresh migration mantém source_checkpoints no contrato scoped do worker anterior', () => {
    const db = createTestDatabase();

    expect(columns(db, 'source_checkpoints')).toEqual(expect.arrayContaining(['flow', 'scope_key']));
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'source_checkpoints_scoped'").get()).toBeUndefined();
    expect(db.prepare("SELECT version FROM schema_migrations WHERE version = '031_source_checkpoint_rollout_repair'").get()).toBeTruthy();
  });

  it('repara a 030 antiga, aceita SELECT/UPSERT do 0aca7bf e mantém market independente', () => {
    const db = createTestDatabase();
    normalizeToPrevious030State(db);
    db.prepare('DELETE FROM source_checkpoints').run();
    db.prepare('DELETE FROM source_checkpoints_scoped').run();

    const scopedInsert = db.prepare(`
      INSERT INTO source_checkpoints_scoped (
        source_code, flow, scope_key, window_start, window_end, cursor, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    scopedInsert.run('PNCP', 'opportunity', 'default', window.dateFrom, window.dateTo, 'scoped:1', 'COMPLETED', '2026-09-02T10:00:00.000Z', '2026-09-02T10:00:00.000Z');
    scopedInsert.run('PNCP', 'market', 'market:1', window.dateFrom, window.dateTo, 'market:1', 'RUNNING', '2026-09-02T10:00:00.000Z', '2026-09-02T10:00:00.000Z');
    db.prepare(`
      INSERT INTO source_checkpoints (
        source_code, window_start, window_end, cursor, status,
        received_count, persisted_count, created_count, updated_count, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 0, 0, 0, 0, ?, ?)
    `).run('PNCP', window.dateFrom, window.dateTo, 'legacy:1', 'COMPLETED', '2026-09-02T11:00:00.000Z', '2026-09-02T11:00:00.000Z');
    db.prepare("DELETE FROM schema_migrations WHERE version = '031_source_checkpoint_rollout_repair'").run();

    migrateDatabase(db);

    const oldWorkerSelect = db.prepare('SELECT flow, scope_key, cursor FROM source_checkpoints WHERE source_code = ? AND flow = ? AND scope_key = ? AND window_start = ? AND window_end = ?');
    expect(oldWorkerSelect.get('PNCP', 'opportunity', 'default', window.dateFrom, window.dateTo)).toMatchObject({ cursor: 'legacy:1' });

    const oldWorkerUpsert = db.prepare(`
      INSERT INTO source_checkpoints (
        source_code, flow, scope_key, window_start, window_end, cursor, status,
        received_count, persisted_count, created_count, updated_count, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, ?, ?)
      ON CONFLICT(source_code, flow, scope_key, window_start, window_end) DO UPDATE SET
        cursor = excluded.cursor, status = excluded.status, updated_at = excluded.updated_at
    `);
    oldWorkerUpsert.run('PNCP', 'opportunity', 'default', window.dateFrom, window.dateTo, 'legacy:2', 'RUNNING', '2026-09-02T12:00:00.000Z', '2026-09-02T12:00:00.000Z');

    const repository = new SourceSyncRepository(db);
    expect(repository.getCheckpoint('PNCP', window, 'opportunity', 'default')).toMatchObject({ cursor: 'legacy:2', status: 'RUNNING' });
    expect(repository.getCheckpoint('PNCP', window, 'market', 'market:1')).toMatchObject({ cursor: 'market:1', status: 'RUNNING' });
    expect(db.prepare("SELECT version FROM schema_migrations WHERE version = '031_source_checkpoint_rollout_repair'").get()).toBeTruthy();
  });
});
