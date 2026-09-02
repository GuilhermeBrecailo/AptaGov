import { describe, expect, it } from 'vitest';
import type { FilterConfig, OpportunityInput } from '../../src/domain/types';
import type { PagedOfficialSourceClient } from '../../src/integrations/sources/OfficialSourceClient';
import { createTestDatabase } from '../../src/db/database';
import { OrganizationRepository } from '../../src/repositories/organizationRepository';
import { OrganizationSyncSettingsRepository } from '../../src/repositories/organizationSyncSettingsRepository';
import { SourceSyncRepository } from '../../src/repositories/sourceSyncRepository';
import { SourceSyncService } from '../../src/services/sourceSyncService';
import { buildPlatformAdminMetrics } from '../../src/services/platformAdminService';
import { loadEnv } from '../../src/config/env';
import { WorkerRuntime } from '../../src/workerRuntime';

const filters: FilterConfig = {
  lookbackDays: 3,
  states: ['SP', 'RJ'],
  citiesIbge: [],
  modalities: ['6'],
  keywords: [],
  excludedKeywords: [],
  minimumScore: 0,
  estimatedValueMinCents: 0,
  scoreWeights: { keyword: 50, region: 20, value: 10, deadline: 20 },
};

type Page = {
  items: OpportunityInput[];
  nextCursor: string | null;
  hasNext: boolean;
  fetchedAt: string;
};

function opportunity(id: string): OpportunityInput {
  return {
    pncpId: id,
    source: 'PNCP',
    sourceCode: 'PNCP',
    title: id,
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

function sourceClient(
  id: 'PNCP' | 'OPEN_DATA',
  pages: (query: { filters: FilterConfig }) => AsyncGenerator<Page>,
): PagedOfficialSourceClient {
  const empty = async () => ({ items: [], nextCursor: null, hasNext: false, fetchedAt: '2026-09-02T10:00:00.000Z' });
  return {
    id,
    listOpportunities: empty,
    listMarketObservations: empty,
    listMarketResults: empty,
    listOpportunityPages: pages,
    async *listMarketPages() {
      yield { items: [], results: [], nextCursor: null, hasNext: false, fetchedAt: '2026-09-02T10:00:00.000Z' };
    },
    async *listMarketObservationPages() {
      yield { items: [], nextCursor: null, hasNext: false, fetchedAt: '2026-09-02T10:00:00.000Z' };
    },
    async *listMarketResultPages() {
      yield { items: [], nextCursor: null, hasNext: false, fetchedAt: '2026-09-02T10:00:00.000Z' };
    },
  };
}

function failingSourceClient(id: 'PNCP' | 'OPEN_DATA'): PagedOfficialSourceClient {
  return sourceClient(id, async function* () {
    throw new Error(`${id} indisponível`);
  });
}

describe('Task 7: falha por escopo e métricas por fonte', () => {
  it('registra a falha na query RJ sem rebaixar o checkpoint concluído de SP', async () => {
    const db = createTestDatabase();
    const repository = new SourceSyncRepository(db);
    const client = sourceClient('PNCP', async function* (query) {
      if (query.filters.states[0] === 'RJ') throw new Error('RJ indisponível');
      yield { items: [opportunity('sp-ok')], nextCursor: null, hasNext: false, fetchedAt: '2026-09-02T10:00:00.000Z' };
    });

    const result = await new SourceSyncService({ clients: [client], repository }).run({
      filters,
      today: new Date('2026-08-31T12:00:00.000Z'),
      throwOnAllFailed: false,
    });

    expect(result.sourceResults).toMatchObject([{ source: 'PNCP', status: 'FAILED', received: 1, errorCategory: 'UNAVAILABLE' }]);
    expect(repository.getCheckpoint('PNCP', { dateFrom: '2026-08-28', dateTo: '2026-08-31' }, 'opportunity', 'default:SP:-:6')).toMatchObject({
      status: 'COMPLETED',
    });
    expect(repository.getCheckpoint('PNCP', { dateFrom: '2026-08-28', dateTo: '2026-08-31' }, 'opportunity', 'default:RJ:-:6')).toMatchObject({
      status: 'FAILED',
      errorCategory: 'UNAVAILABLE',
    });
    expect(repository.listRuns({ sourceCode: 'PNCP', flow: 'opportunity' })).toEqual(expect.arrayContaining([
      expect.objectContaining({ scopeKey: 'default:SP:-:6', status: 'COMPLETED' }),
      expect.objectContaining({ scopeKey: 'default:RJ:-:6', status: 'FAILED', errorCategory: 'UNAVAILABLE' }),
    ]));
  });

  it('preserva falha de cada fonte no resultado do ciclo e no painel administrativo', async () => {
    const db = createTestDatabase();
    const organization = new OrganizationRepository(db).create('Empresa Fonte');
    new OrganizationSyncSettingsRepository(db).save(organization.id, true);
    const env = loadEnv({ NODE_ENV: 'test', DATABASE_URL: ':memory:' });
    const runtime = new WorkerRuntime(env, db, {
      sourceClients: [failingSourceClient('PNCP'), failingSourceClient('OPEN_DATA')],
    });

    const cycle = await runtime.runCycle({ mode: 'automatic' });
    const sourceResults = cycle.metrics.sourceResults;

    expect(sourceResults).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: 'PNCP', status: 'FAILED', errorCategory: 'UNAVAILABLE' }),
      expect.objectContaining({ source: 'OPEN_DATA', status: 'FAILED', errorCategory: 'UNAVAILABLE' }),
    ]));
    expect(db.prepare("SELECT source_code, status, error_category FROM source_runs WHERE flow = 'opportunity'").all()).toEqual(expect.arrayContaining([
      expect.objectContaining({ source_code: 'PNCP', status: 'FAILED', error_category: 'UNAVAILABLE' }),
      expect.objectContaining({ source_code: 'OPEN_DATA', status: 'FAILED', error_category: 'UNAVAILABLE' }),
    ]));

    const admin = buildPlatformAdminMetrics(db, env.billingPlans);
    expect(admin.worker.cycles[0]?.sourceResults).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: 'PNCP', status: 'FAILED', errorCategory: 'UNAVAILABLE' }),
      expect.objectContaining({ source: 'OPEN_DATA', status: 'FAILED', errorCategory: 'UNAVAILABLE' }),
    ]));
    runtime.close();
  });
});
