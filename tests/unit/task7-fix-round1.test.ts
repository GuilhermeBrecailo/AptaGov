import { describe, expect, it } from 'vitest';
import { createTestDatabase } from '../../src/db/database';
import type {
  MarketQuery,
  SourcePage,
  SourceQuery,
  SourceWindow,
} from '../../src/domain/sourceTypes';
import { syncSourceMarket, syncSourceOpportunities } from '../../src/integrations/sources/OfficialSourceClient';
import type { PagedOfficialSourceClient } from '../../src/integrations/sources/OfficialSourceClient';
import { JobRepository } from '../../src/repositories/jobRepository';
import { SourceSyncRepository } from '../../src/repositories/sourceSyncRepository';

const window: SourceWindow = {
  dateFrom: '2026-08-28',
  dateTo: '2026-08-31',
};

const filters = {
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

function emptyPage<T>(nextCursor: string | null = null): SourcePage<T> {
  return {
    items: [],
    nextCursor,
    hasNext: nextCursor !== null,
    fetchedAt: '2026-09-02T10:00:00.000Z',
  };
}

function sourceClient(): PagedOfficialSourceClient {
  return {
    id: 'BEC/SP',
    listOpportunities: async () => emptyPage(),
    listMarketObservations: async () => emptyPage(),
    listMarketResults: async () => emptyPage(),
    async *listOpportunityPages(_query: SourceQuery) {
      yield emptyPage();
    },
    async *listMarketPages(_query: MarketQuery) {
      yield { ...emptyPage(), results: [] };
    },
    async *listMarketObservationPages(_query: MarketQuery) {
      yield emptyPage();
    },
    async *listMarketResultPages(_query: MarketQuery) {
      yield emptyPage();
    },
  };
}

describe('Task 7 fix round 1: durabilidade mínima', () => {
  it('separa checkpoints de opportunity e market por fluxo e escopo', () => {
    const repository = new SourceSyncRepository(createTestDatabase());

    repository.persistOpportunityPage({
      sourceCode: 'PNCP',
      window,
      cursor: null,
      nextCursor: 'opportunity:2',
      scopeKey: 'radar-a',
      items: [],
    });
    repository.persistMarketBundlePage({
      sourceCode: 'PNCP',
      window,
      cursor: null,
      nextCursor: 'market:2',
      scopeKey: 'radar-a',
      observations: [],
      results: [],
    });
    repository.persistOpportunityPage({
      sourceCode: 'PNCP',
      window,
      cursor: null,
      nextCursor: 'opportunity-b:2',
      scopeKey: 'radar-b',
      items: [],
    });

    expect(repository.getResumeCursor('PNCP', window, 'opportunity', 'radar-a')).toBe('opportunity:2');
    expect(repository.getResumeCursor('PNCP', window, 'market', 'radar-a')).toBe('market:2');
    expect(repository.getResumeCursor('PNCP', window, 'opportunity', 'radar-b')).toBe('opportunity-b:2');
  });

  it('faz create e claim de job com chave operacional e lease exclusivo', () => {
    const repository = new JobRepository(createTestDatabase());
    const checkpoint = { organizationId: 7, radarId: 11 };

    const first = repository.create('source_sync', checkpoint, 'source:PNCP:opportunity:7:11', checkpoint);
    const duplicate = repository.create('source_sync', checkpoint, 'source:PNCP:opportunity:7:11', checkpoint);

    expect(duplicate).toBe(first);
    expect(repository.claim(first, 'runtime-a', 60_000, checkpoint)).toBe(true);
    expect(repository.claim(first, 'runtime-b', 60_000, checkpoint)).toBe(false);
    expect(repository.find(first)).toMatchObject({ leaseOwner: 'runtime-a' });
    expect(repository.recoverInterrupted(new Date())).toHaveLength(0);
    expect(repository.recoverInterrupted(new Date(Date.now() + 61_000))).toHaveLength(1);
  });

  it('abre e conclui source_runs independentemente por fonte e fluxo', async () => {
    const db = createTestDatabase();
    const repository = new SourceSyncRepository(db);
    const client = sourceClient();
    const query = { ...window, filters };

    await syncSourceOpportunities(client, { ...query, scopeKey: 'radar-a' }, repository);
    await syncSourceMarket(client, { ...query, scopeKey: 'market-refresh' }, repository);

    const runs = db.prepare(
      'SELECT flow, scope_key, status FROM source_runs ORDER BY id ASC',
    ).all() as Array<{ flow: string; scope_key: string; status: string }>;

    expect(runs).toEqual(expect.arrayContaining([
      { flow: 'opportunity', scope_key: 'radar-a', status: 'COMPLETED' },
      { flow: 'market', scope_key: 'market-refresh', status: 'COMPLETED' },
    ]));
  });
});
