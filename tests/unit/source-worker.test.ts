import { describe, expect, it } from 'vitest';
import type { FilterConfig, OpportunityInput } from '../../src/domain/types';
import type { SourceId } from '../../src/domain/sourceTypes';
import type { PagedOfficialSourceClient } from '../../src/integrations/sources/OfficialSourceClient';
import { createTestDatabase } from '../../src/db/database';
import { JobRepository } from '../../src/repositories/jobRepository';
import { OpportunityRepository } from '../../src/repositories/opportunityRepository';
import { SourceSyncRepository } from '../../src/repositories/sourceSyncRepository';
import { SourceSyncService } from '../../src/services/sourceSyncService';

const filters: FilterConfig = {
  lookbackDays: 3,
  states: ['SP'],
  citiesIbge: [],
  modalities: ['6'],
  keywords: [],
  excludedKeywords: [],
  minimumScore: 0,
  estimatedValueMinCents: 0,
  scoreWeights: { keyword: 50, region: 20, value: 10, deadline: 20 },
};

function record(id: string, sourceCode: SourceId = 'PNCP'): OpportunityInput {
  return {
    pncpId: id,
    sourceCode,
    source: sourceCode,
    title: `Oportunidade ${id}`,
    description: 'Servico oficial',
    organization: 'Orgao oficial',
    state: 'SP',
    city: 'Sao Paulo',
    modality: 'Pregao',
    sourceUrl: `https://pncp.gov.br/${id}`,
    publicationDate: '2026-08-31T10:00:00.000Z',
    biddingDeadline: null,
    estimatedValueCents: 0,
  };
}

type Page = {
  items: OpportunityInput[];
  nextCursor: string | null;
  hasNext: boolean;
  fetchedAt: string;
};

function sourceClient(
  id: 'PNCP' | 'OPEN_DATA' | 'BEC/SP',
  listPages: (query: { cursor?: string | null }) => AsyncGenerator<Page>,
): PagedOfficialSourceClient {
  const empty = async () => ({ items: [], nextCursor: null, hasNext: false, fetchedAt: new Date().toISOString() });
  return {
    id,
    listOpportunities: empty,
    listMarketObservations: empty,
    listMarketResults: empty,
    listOpportunityPages: listPages,
    listMarketPages: async function* () { yield { items: [], results: [], nextCursor: null, hasNext: false, fetchedAt: new Date().toISOString() }; },
    listMarketObservationPages: async function* () { yield { items: [], nextCursor: null, hasNext: false, fetchedAt: new Date().toISOString() }; },
    listMarketResultPages: async function* () { yield { items: [], nextCursor: null, hasNext: false, fetchedAt: new Date().toISOString() }; },
  };
}

describe('worker de fontes oficiais', () => {
  it('isola fonte indisponivel e mantem a fonte saudavel', async () => {
    const db = createTestDatabase();
    const repository = new SourceSyncRepository(db, new OpportunityRepository(db));
    const healthy = sourceClient('PNCP', async function* () {
      yield { items: [record('healthy')], nextCursor: null, hasNext: false, fetchedAt: new Date().toISOString() };
    });
    const failing = sourceClient('OPEN_DATA', async function* () {
      yield* [];
      throw new Error('Dados Abertos indisponivel');
    });
    const service = new SourceSyncService({ clients: [healthy, failing], repository });

    const result = await service.run({ filters, today: new Date('2026-08-31T12:00:00.000Z') });

    expect(result.sourceResults).toMatchObject([
      { source: 'PNCP', status: 'COMPLETED', received: 1 },
      { source: 'OPEN_DATA', status: 'FAILED', errorCategory: 'UNAVAILABLE' },
    ]);
    expect(new OpportunityRepository(db).findByPncpId('healthy')).toBeDefined();
    expect(repository.getCheckpoint('PNCP', { dateFrom: '2026-08-28', dateTo: '2026-08-31' })?.status).toBe('COMPLETED');
  });

  it('mantem o registro canonico PNCP quando a mesma oportunidade chega de outra fonte', async () => {
    const db = createTestDatabase();
    const repository = new SourceSyncRepository(db, new OpportunityRepository(db));
    const pncp = sourceClient('PNCP', async function* () {
      yield { items: [record('duplicate', 'PNCP')], nextCursor: null, hasNext: false, fetchedAt: new Date().toISOString() };
    });
    const openData = sourceClient('OPEN_DATA', async function* () {
      yield { items: [record('duplicate', 'OPEN_DATA')], nextCursor: null, hasNext: false, fetchedAt: new Date().toISOString() };
    });

    await new SourceSyncService({ clients: [pncp, openData], repository }).run({ filters, today: new Date('2026-08-31T12:00:00.000Z') });

    const opportunity = new OpportunityRepository(db).findByPncpId('duplicate');
    expect(opportunity?.sourceCode).toBe('PNCP');
    expect(new OpportunityRepository(db).count()).toBe(1);
  });

  it('retoma pelo checkpoint e persiste a ultima pagina', async () => {
    const db = createTestDatabase();
    const opportunities = new OpportunityRepository(db);
    const repository = new SourceSyncRepository(db, opportunities);
    const requestedCursors: Array<string | null | undefined> = [];
    let fail = true;
    const client = sourceClient('PNCP', async function* (query) {
      requestedCursors.push(query.cursor);
      if (!query.cursor) {
        yield { items: [record('page-1')], nextCursor: 'page:2', hasNext: true, fetchedAt: new Date().toISOString() };
        if (fail) throw new Error('resposta interrompida');
      }
      yield { items: [record('page-2')], nextCursor: null, hasNext: false, fetchedAt: new Date().toISOString() };
    });
    const service = new SourceSyncService({ clients: [client], repository });

    await expect(service.run({ filters, today: new Date('2026-08-31T12:00:00.000Z') })).rejects.toThrow('resposta interrompida');
    fail = false;
    const result = await service.run({ filters, today: new Date('2026-08-31T12:00:00.000Z') });

    expect(requestedCursors).toEqual([null, 'page:2']);
    expect(result.sourceResults[0]).toMatchObject({ status: 'COMPLETED', received: 1 });
    expect(opportunities.count()).toBe(2);
  });

  it('reutiliza job recuperado e nao cria duplicata por chave operacional', () => {
    const db = createTestDatabase();
    const repository = new JobRepository(db);
    const first = repository.create('source_sync', { source: 'PNCP', window: '2026-08-31' }, 'source:PNCP:2026-08-31');
    repository.markRunning(first);

    const recovered = repository.recoverInterrupted();
    const reused = repository.create('source_sync', { source: 'PNCP', window: '2026-08-31' }, 'source:PNCP:2026-08-31');

    expect(recovered.map((job) => job.id)).toEqual([first]);
    expect(reused).toBe(first);
    expect(repository.list().filter((job) => job.type === 'source_sync')).toHaveLength(1);
  });
});
