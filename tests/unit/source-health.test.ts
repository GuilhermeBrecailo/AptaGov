import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createTestDatabase } from '../../src/db/database';
import { loadEnv } from '../../src/config/env';

const root = resolve('C:/Users/user/Documents/dev/licitacoes-pncp');

describe('saúde agregada das fontes', () => {
  it('expõe a saúde somente pelo guard de administrador da plataforma', () => {
    const routePath = resolve(root, 'server/api/source-health.get.ts');
    expect(existsSync(routePath)).toBe(true);
    if (!existsSync(routePath)) return;

    const route = readFileSync(routePath, 'utf8');
    expect(route).toContain('requirePlatformAdmin(event)');
    expect(route).toContain('buildSourceHealthMetrics');
  });

  it('agrega checkpoint e falhas sem devolver escopo de tenant', async () => {
    const module = await import('../../src/services/platformAdminService');
    const buildSourceHealthMetrics = (module as unknown as {
      buildSourceHealthMetrics?: (db: ReturnType<typeof createTestDatabase>, env: ReturnType<typeof loadEnv>, now?: Date) => unknown;
    }).buildSourceHealthMetrics;
    expect(buildSourceHealthMetrics).toBeTypeOf('function');
    if (!buildSourceHealthMetrics) return;

    const db = createTestDatabase();
    db.prepare(`
      INSERT INTO source_runs (
        source_code, flow, scope_key, window_start, window_end, cursor, status,
        received_count, persisted_count, created_count, updated_count, error_category,
        error_message, started_at, finished_at, created_at, updated_at
      ) VALUES ('PNCP', 'opportunity', 'organization:tenant-secret', '2026-09-01', '2026-09-02', 'cursor-2', 'FAILED',
        4, 3, 2, 1, 'UNAVAILABLE', 'secret tenant error', '2026-09-02T10:00:00.000Z',
        '2026-09-02T10:01:00.000Z', '2026-09-02T10:01:00.000Z', '2026-09-02T10:01:00.000Z')
    `).run();
    db.prepare(`
      INSERT INTO source_checkpoints (
        source_code, flow, scope_key, window_start, window_end, cursor, status,
        received_count, persisted_count, created_count, updated_count, last_success_at, created_at, updated_at
      ) VALUES ('PNCP', 'opportunity', 'organization:tenant-secret', '2026-09-01', '2026-09-02', 'cursor-1', 'COMPLETED',
        4, 4, 4, 0, '2026-09-02T09:00:00.000Z', '2026-09-02T09:00:00.000Z', '2026-09-02T09:00:00.000Z')
    `).run();

    const health = buildSourceHealthMetrics(db, loadEnv({ NODE_ENV: 'test', DATABASE_URL: ':memory:' }), new Date('2026-09-02T12:00:00.000Z')) as Record<string, unknown>;
    const serialized = JSON.stringify(health);

    expect(health).toHaveProperty('sources');
    expect(health).toHaveProperty('queueDepth');
    expect(health).toHaveProperty('notificationFailures');
    expect(health).toHaveProperty('backupAgeMs');
    expect(health).toHaveProperty('pauseReason');
    expect(serialized).not.toContain('tenant-secret');
    expect(serialized).not.toContain('secret tenant error');
  });
});
