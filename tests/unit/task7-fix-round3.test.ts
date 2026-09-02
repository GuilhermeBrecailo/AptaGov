import { describe, expect, it } from 'vitest';
import { loadEnv } from '../../src/config/env';
import { createTestDatabase } from '../../src/db/database';
import type { SourceWindow } from '../../src/domain/sourceTypes';
import { OrganizationRepository } from '../../src/repositories/organizationRepository';
import { OrganizationSyncSettingsRepository } from '../../src/repositories/organizationSyncSettingsRepository';
import { SavedSearchRepository } from '../../src/repositories/savedSearchRepository';
import { SourceSyncRepository } from '../../src/repositories/sourceSyncRepository';
import { SystemStateRepository } from '../../src/repositories/systemStateRepository';
import { WorkerMetricsRepository } from '../../src/repositories/workerMetricsRepository';
import { buildPlatformAdminMetrics } from '../../src/services/platformAdminService';
import { WorkerRuntime } from '../../src/workerRuntime';

const window: SourceWindow = { dateFrom: '2026-08-28', dateTo: '2026-08-31' };
const filters = {
  lookbackDays: 3,
  states: [],
  citiesIbge: [],
  modalities: ['6'],
  keywords: [],
  excludedKeywords: [],
  minimumScore: 0,
  estimatedValueMinCents: 0,
  scoreWeights: { keyword: 50, region: 20, value: 10, deadline: 20 },
};

describe('Task 7 fix round 3: pendências operacionais', () => {
  it('mantém pausa global legada ativa ao lado de pausa composta e bloqueia todo o ciclo', async () => {
    const db = createTestDatabase();
    const organization = new OrganizationRepository(db).create('Empresa Pausada');
    new OrganizationSyncSettingsRepository(db).save(organization.id, true);
    const state = new SystemStateRepository(db);
    state.pause('Pausa global manual');
    state.pauseStage('market', 'PNCP indisponível', { source: 'PNCP' });
    const runtime = new WorkerRuntime(loadEnv({ NODE_ENV: 'test', DATABASE_URL: ':memory:' }), db, { sourceClients: [] });

    expect(state.status()).toMatchObject({ paused: true, global: true });
    expect(state.isStagePaused('backup')).toBe(true);
    const result = await runtime.runCycle({ mode: 'automatic' });

    expect(result.paused).toBe(true);
    expect(runtime.jobs.list('PENDING')).toHaveLength(0);
    state.resume({ stage: 'market', source: 'PNCP' });
    expect(state.status()).toMatchObject({ paused: true, global: true });
    runtime.close();
  });

  it('faz limpeza parcial sem liberar pausa global quando o health check global falha', async () => {
    const db = createTestDatabase();
    const state = new SystemStateRepository(db);
    state.pause('Pausa global manual');
    state.pauseStage('notifications', 'E-mail fora do ar', { channel: 'email' });
    const runtime = new WorkerRuntime(loadEnv({ NODE_ENV: 'test', DATABASE_URL: ':memory:' }), db, {
      sourceClients: [],
      healthCheck: async () => false,
      healthChecks: { notifications: async () => true },
      notificationHealthChecks: { email: async () => true },
    });

    expect(await runtime.resumeAfterHealthCheck()).toBe(false);
    expect(state.status()).toMatchObject({ paused: true, global: true });
    expect(state.listPauses().some((pause) => pause.stage === 'notifications')).toBe(false);
    runtime.close();
  });

  it('não libera canal de e-mail apenas porque as credenciais estão configuradas', async () => {
    const db = createTestDatabase();
    const state = new SystemStateRepository(db);
    state.pauseStage('notifications', 'E-mail fora do ar', { channel: 'email' });
    const runtime = new WorkerRuntime(loadEnv({
      NODE_ENV: 'test',
      DATABASE_URL: ':memory:',
      RESEND_API_KEY: 'configured-but-unverified',
      NOTIFICATION_EMAIL_FROM: 'operacao@example.com',
    }), db, {
      sourceClients: [],
      healthCheck: async () => true,
      healthChecks: { notifications: async () => true },
      notificationHealthChecks: { email: async () => false },
    });

    expect(await runtime.resumeAfterHealthCheck()).toBe(false);
    expect(state.isStagePaused('notifications', { channel: 'email' })).toBe(true);
    runtime.close();
  });

  it('mantém compatibilidade de leitura do checkpoint sem compartilhar namespaces', () => {
    const db = createTestDatabase();
    const repository = new SourceSyncRepository(db);
    repository.beginRun('PNCP', window, null, 'market', 'market:compat');

    expect(repository.getCheckpoint('PNCP', window)).toMatchObject({ flow: 'market', scopeKey: 'market:compat' });
    expect(repository.getCheckpoint('PNCP', window, 'market', 'market:compat')).toMatchObject({ flow: 'market' });
  });

  it('rejeita sincronização manual com radar de outra organização', async () => {
    const db = createTestDatabase();
    const organizations = new OrganizationRepository(db);
    const organizationA = organizations.create('Empresa A');
    const organizationB = organizations.create('Empresa B');
    const radar = new SavedSearchRepository(db).create(organizationA.id, 'Radar A', filters);
    const runtime = new WorkerRuntime(loadEnv({ NODE_ENV: 'test', DATABASE_URL: ':memory:' }), db, { sourceClients: [] });

    await expect(runtime.runCycle({ mode: 'manual', organizationId: organizationB.id, radarId: radar.id })).rejects.toThrow(/radar/i);
    runtime.close();
  });

  it('expõe source_runs e métricas de worker sem payload sensível no painel administrativo', () => {
    const db = createTestDatabase();
    const source = new SourceSyncRepository(db);
    const runId = source.beginRun('PNCP', window, null, 'opportunity', 'organization:7');
    source.failRun(runId, 'UNAVAILABLE', 'não deve ser exposto');
    new WorkerMetricsRepository(db).save('automatic', {
      startedAt: '2026-09-02T10:00:00.000Z',
      finishedAt: '2026-09-02T10:01:00.000Z',
      jobsFailed: 1,
      sourceResults: [{ source: 'PNCP', status: 'FAILED', errorCategory: 'UNAVAILABLE' }],
    }, true);

    const metrics = buildPlatformAdminMetrics(db, loadEnv({ NODE_ENV: 'test', DATABASE_URL: ':memory:' }).billingPlans);

    expect(metrics.worker.sourceRuns).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: 'PNCP', flow: 'opportunity', scopeKey: 'organization:7', status: 'FAILED', errorCategory: 'UNAVAILABLE' }),
    ]));
    expect(metrics.worker.cycles[0]).toMatchObject({ mode: 'automatic', paused: true, jobsFailed: 1 });
    expect(JSON.stringify(metrics.worker)).not.toContain('não deve ser exposto');
  });

  it('não deixa job durável com payload inválido órfão em PENDING', async () => {
    const db = createTestDatabase();
    const organization = new OrganizationRepository(db).create('Empresa Legado');
    new OrganizationSyncSettingsRepository(db).save(organization.id, true);
    const runtime = new WorkerRuntime(loadEnv({ NODE_ENV: 'test', DATABASE_URL: ':memory:' }), db, { sourceClients: [] });
    const jobId = runtime.jobs.create('source_sync', { jobKey: 'legacy-invalid' }, 'legacy-invalid');

    await runtime.runCycle({ mode: 'automatic' });

    expect(runtime.jobs.find(jobId)?.status).toBe('FAILED');
    runtime.close();
  });
});
