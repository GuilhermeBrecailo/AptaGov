import Database from 'better-sqlite3';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { loadEnv } from '../../src/config/env';
import { createTestDatabase } from '../../src/db/database';
import { SourceSyncRepository } from '../../src/repositories/sourceSyncRepository';
import { SystemStateRepository } from '../../src/repositories/systemStateRepository';
import { WorkerMetricsRepository } from '../../src/repositories/workerMetricsRepository';
import { createDatabaseBackup, validateDatabaseBackupArtifact } from '../../src/services/backupService';
import { WorkerRuntime } from '../../src/workerRuntime';

const window = { dateFrom: '2026-08-28', dateTo: '2026-08-31' };

describe('Task 7: compatibilidade legada e health checks efetivos', () => {
  it('mantém ON CONFLICT legado funcional sem compartilhar cursor com o namespace scoped', () => {
    const db = createTestDatabase();
    const scopedColumns = (db.prepare("PRAGMA table_info('source_checkpoints_scoped')").all() as Array<{ name: string }>).map((row) => row.name);
    const legacyColumns = (db.prepare("PRAGMA table_info('source_checkpoints')").all() as Array<{ name: string }>).map((row) => row.name);
    expect(scopedColumns).toEqual(expect.arrayContaining(['flow', 'scope_key']));
    expect(legacyColumns).toEqual(expect.arrayContaining(['source_code', 'window_start', 'window_end', 'cursor', 'status']));
    expect(legacyColumns).not.toContain('flow');

    const legacyUpsert = db.prepare(`
      INSERT INTO source_checkpoints (
        source_code, window_start, window_end, cursor, status,
        received_count, persisted_count, created_count, updated_count,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 0, 0, 0, 0, ?, ?)
      ON CONFLICT(source_code, window_start, window_end) DO UPDATE SET
        cursor = excluded.cursor, status = excluded.status, updated_at = excluded.updated_at
    `);
    legacyUpsert.run('PNCP', window.dateFrom, window.dateTo, 'legacy:2', 'RUNNING', '2026-09-02T10:00:00.000Z', '2026-09-02T10:00:00.000Z');
    legacyUpsert.run('PNCP', window.dateFrom, window.dateTo, 'legacy:3', 'COMPLETED', '2026-09-02T10:01:00.000Z', '2026-09-02T10:01:00.000Z');

    const repository = new SourceSyncRepository(db);
    expect(repository.getCheckpoint('PNCP', window, 'opportunity', 'default')).toMatchObject({
      flow: 'opportunity',
      scopeKey: 'default',
      cursor: 'legacy:3',
      status: 'COMPLETED',
    });
    repository.beginRun('PNCP', window, null, 'market', 'market:separate');
    expect(db.prepare("SELECT cursor FROM source_checkpoints_scoped WHERE source_code = 'PNCP' AND flow = 'market' AND scope_key = 'market:separate'").get()).toMatchObject({ cursor: null });
    expect(db.prepare('SELECT cursor FROM source_checkpoints WHERE source_code = ? AND window_start = ? AND window_end = ?').get('PNCP', window.dateFrom, window.dateTo)).toMatchObject({ cursor: 'legacy:3' });

    repository.recordFailure('PNCP', window, 'UNAVAILABLE', null, 'opportunity', 'default');
    expect(db.prepare('SELECT status FROM source_checkpoints WHERE source_code = ? AND window_start = ? AND window_end = ?').get('PNCP', window.dateFrom, window.dateTo)).toMatchObject({ status: 'FAILED' });
  });

  it('não libera pausa de notificações sem canal enquanto algum canal configurado não estiver saudável', async () => {
    const db = createTestDatabase();
    const state = new SystemStateRepository(db);
    state.pauseStage('notifications', 'Canais de notificação indisponíveis');
    const runtime = new WorkerRuntime(loadEnv({
      NODE_ENV: 'test',
      DATABASE_URL: ':memory:',
      RESEND_API_KEY: 'configured',
      NOTIFICATION_EMAIL_FROM: 'operacao@example.com',
      VAPID_SUBJECT: 'mailto:operacao@example.com',
      VAPID_PUBLIC_KEY: 'public',
      VAPID_PRIVATE_KEY: 'private',
    }), db, {
      sourceClients: [],
      healthCheck: async () => true,
      healthChecks: { notifications: async () => true },
      notificationHealthChecks: { email: async () => true, push: async () => false },
    });

    expect(await runtime.resumeAfterHealthCheck()).toBe(false);
    expect(state.isStagePaused('notifications')).toBe(true);
    runtime.close();
  });

  it('mantém a pausa global quando um componente composto ainda está insalubre', async () => {
    const db = createTestDatabase();
    const state = new SystemStateRepository(db);
    state.pause('Pausa global manual');
    state.pauseStage('notifications', 'E-mail indisponível', { channel: 'email' });
    const runtime = new WorkerRuntime(loadEnv({ NODE_ENV: 'test', DATABASE_URL: ':memory:' }), db, {
      sourceClients: [],
      healthCheck: async () => true,
      notificationHealthChecks: { email: async () => false },
    });

    expect(await runtime.resumeAfterHealthCheck()).toBe(false);
    expect(state.status()).toMatchObject({ paused: true, global: true });
    expect(state.isStagePaused('notifications', { channel: 'email' })).toBe(true);
    runtime.close();
  });

  it('exige integrity_check ok e artefato de destino válido para liberar backup', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'licitacoes-task7-backup-'));
    const invalidArtifact = join(directory, 'invalid.db');
    writeFileSync(invalidArtifact, 'not-a-sqlite-database');
    expect(validateDatabaseBackupArtifact(invalidArtifact)).toBe(false);

    const db = createTestDatabase();
    const state = new SystemStateRepository(db);
    state.pauseStage('backup', 'Backup indisponível');
    new WorkerMetricsRepository(db).save('automatic', {
      startedAt: '2026-09-02T10:00:00.000Z',
      finishedAt: '2026-09-02T10:01:00.000Z',
      backupPath: invalidArtifact,
    }, true);
    const runtime = new WorkerRuntime(loadEnv({ NODE_ENV: 'test', DATABASE_URL: ':memory:' }), db, {
      sourceClients: [],
      healthChecks: { backup: async () => true },
    });

    expect(await runtime.resumeAfterHealthCheck()).toBe(false);
    expect(state.isStagePaused('backup')).toBe(true);
    runtime.close();

    const sourcePath = join(directory, 'source.db');
    const sourceDb = new Database(sourcePath);
    sourceDb.exec('CREATE TABLE sample (id INTEGER PRIMARY KEY, value TEXT NOT NULL)');
    const backupPath = createDatabaseBackup(sourceDb, sourcePath, directory);
    sourceDb.close();
    expect(validateDatabaseBackupArtifact(backupPath)).toBe(true);
    rmSync(directory, { recursive: true, force: true });
  });
});
