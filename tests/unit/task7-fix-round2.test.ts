import { describe, expect, it } from 'vitest';
import type { FilterConfig, OpportunityInput } from '../../src/domain/types';
import type { PagedOfficialSourceClient } from '../../src/integrations/sources/OfficialSourceClient';
import type { MarketQuery, SourcePage, SourceQuery } from '../../src/domain/sourceTypes';
import { createTestDatabase } from '../../src/db/database';
import { JobRepository } from '../../src/repositories/jobRepository';
import { OperationalOutboxRepository } from '../../src/repositories/operationalOutboxRepository';
import { SourceSyncRepository } from '../../src/repositories/sourceSyncRepository';
import { SystemStateRepository } from '../../src/repositories/systemStateRepository';
import { MarketRefreshService } from '../../src/services/marketRefreshService';
import { SourceSyncService } from '../../src/services/sourceSyncService';
import { WorkerRuntime } from '../../src/workerRuntime';
import { loadEnv } from '../../src/config/env';
import { OrganizationRepository } from '../../src/repositories/organizationRepository';

const filters: FilterConfig = {
  lookbackDays: 3,
  states: ['SP'],
  citiesIbge: [],
  modalities: [],
  keywords: [],
  excludedKeywords: [],
  minimumScore: 0,
  estimatedValueMinCents: 0,
  scoreWeights: { keyword: 50, region: 20, value: 10, deadline: 20 },
};

function opportunity(id: string): OpportunityInput {
  return {
    pncpId: id,
    source: 'PNCP',
    sourceCode: 'PNCP',
    title: `Oportunidade ${id}`,
    description: 'Fonte oficial',
    organization: 'Prefeitura',
    state: 'SP',
    city: 'São Paulo',
    modality: 'Pregão',
    sourceUrl: `https://pncp.gov.br/${id}`,
    publicationDate: '2026-08-31T10:00:00.000Z',
    biddingDeadline: null,
    estimatedValueCents: 0,
  };
}

function sourceClient(page: SourcePage<OpportunityInput>): PagedOfficialSourceClient {
  const empty = async () => ({ items: [], nextCursor: null, hasNext: false, fetchedAt: '2026-09-02T10:00:00.000Z' });
  return {
    id: 'PNCP',
    listOpportunities: empty,
    listMarketObservations: empty,
    listMarketResults: empty,
    async *listOpportunityPages(_query: SourceQuery) {
      yield page;
    },
    async *listMarketPages(_query: MarketQuery) {
      yield { items: [], results: [], nextCursor: null, hasNext: false, fetchedAt: '2026-09-02T10:00:00.000Z' };
    },
    async *listMarketObservationPages(_query: MarketQuery) {
      yield { items: [], nextCursor: null, hasNext: false, fetchedAt: '2026-09-02T10:00:00.000Z' };
    },
    async *listMarketResultPages(_query: MarketQuery) {
      yield { items: [], nextCursor: null, hasNext: false, fetchedAt: '2026-09-02T10:00:00.000Z' };
    },
  };
}

describe('Task 7 fix round 2: efeitos duráveis e escopo', () => {
  it('mantém o evento operacional no outbox quando o hook falha depois da persistência', async () => {
    const db = createTestDatabase();
    const repository = new SourceSyncRepository(db);
    const client = sourceClient({
      items: [opportunity('outbox-after-hook-failure')],
      nextCursor: null,
      hasNext: false,
      fetchedAt: '2026-09-02T10:00:00.000Z',
    });

    await expect(new SourceSyncService({ clients: [client], repository }).run({
      filters,
      today: new Date('2026-08-31T12:00:00.000Z'),
      organizationId: 17,
      scopeKey: 'organization:17',
      onEntry: () => { throw new Error('hook caiu'); },
    })).rejects.toThrow('hook caiu');

    expect(new OperationalOutboxRepository(db).listPending(17)).toHaveLength(1);
    expect(repository.getResumeCursor(
      'PNCP',
      { dateFrom: '2026-08-28', dateTo: '2026-08-31' },
      'opportunity',
      'organization:17',
    )).toBeNull();
  });

  it('faz merge das pausas por estágio, fonte e canal e limpa apenas a condição saudável', async () => {
    const db = createTestDatabase();
    const state = new SystemStateRepository(db);
    state.pauseStage('source', 'PNCP fora do ar', { source: 'PNCP' });
    state.pauseStage('notifications', 'E-mail fora do ar', { channel: 'email' });
    state.pauseStage('backup', 'Backup indisponível');

    expect(state.isStagePaused('source', { source: 'PNCP' })).toBe(true);
    expect(state.isStagePaused('source', { source: 'OPEN_DATA' })).toBe(false);
    expect(state.isStagePaused('notifications', { channel: 'email' })).toBe(true);
    expect(state.isStagePaused('backup')).toBe(true);

    const runtime = new WorkerRuntime(loadEnv({ NODE_ENV: 'test', DATABASE_URL: ':memory:' }), db, {
      sourceClients: [],
      healthChecks: {
        source: async () => false,
        notifications: async () => true,
        backup: async () => false,
      },
    });

    expect(await runtime.resumeAfterHealthCheck()).toBe(false);
    expect(state.isStagePaused('source', { source: 'PNCP' })).toBe(true);
    expect(state.isStagePaused('notifications', { channel: 'email' })).toBe(false);
    expect(state.isStagePaused('backup')).toBe(true);
    runtime.close();
  });

  it('não consome job pendente de outra organização em sincronização manual', async () => {
    const db = createTestDatabase();
    const organizations = new OrganizationRepository(db);
    const organizationA = organizations.create('Empresa A');
    const organizationB = organizations.create('Empresa B');
    const jobs = new JobRepository(db);
    const payload = {
      organizationId: organizationA.id,
      radarId: null,
      filters,
      today: '2026-08-31T12:00:00.000Z',
    };
    const jobA = jobs.create('source_sync', payload, 'manual:source:A', { organizationId: organizationA.id });

    const runtime = new WorkerRuntime(loadEnv({ NODE_ENV: 'test', DATABASE_URL: ':memory:' }), db, { sourceClients: [] });
    await runtime.runCycle({ mode: 'manual', organizationId: organizationB.id });

    expect(runtime.jobs.find(jobA)?.status).toBe('PENDING');
    runtime.close();
  });

  it('expõe resultados de mercado por fonte nas métricas persistíveis', async () => {
    const db = createTestDatabase();
    const repository = new SourceSyncRepository(db);
    const client = sourceClient({
      items: [],
      nextCursor: null,
      hasNext: false,
      fetchedAt: '2026-09-02T10:00:00.000Z',
    });
    const result = await new MarketRefreshService({ clients: [client], repository }).run({ filters, today: new Date('2026-08-31T12:00:00.000Z') });

    expect(result.sourceResults).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: 'PNCP', status: 'COMPLETED', observationsReceived: 0, resultsReceived: 0 }),
    ]));
  });
});
