import { describe, expect, it } from 'vitest';
import type { FilterConfig, OpportunityInput } from '../../src/domain/types';
import type { PagedOfficialSourceClient } from '../../src/integrations/sources/OfficialSourceClient';
import { loadEnv } from '../../src/config/env';
import { createTestDatabase } from '../../src/db/database';
import { OrganizationFilterRepository } from '../../src/repositories/organizationFilterRepository';
import { OrganizationRepository } from '../../src/repositories/organizationRepository';
import { WorkerRuntime } from '../../src/workerRuntime';

const filters: FilterConfig = {
  lookbackDays: 3,
  states: ['SP'],
  citiesIbge: [],
  modalities: [],
  keywords: ['obra'],
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
    title: `Obra de pavimentação ${id}`,
    description: 'Fonte oficial',
    organization: 'Prefeitura',
    state: 'SP',
    city: 'Sao Paulo',
    modality: 'Concorrência',
    sourceUrl: `https://pncp.gov.br/${id}`,
    publicationDate: '2026-08-31T10:00:00.000Z',
    biddingDeadline: null,
    estimatedValueCents: 0,
  };
}

describe('classificação progressiva durante a sincronização', () => {
  it('pontua as licitações já gravadas antes de a sincronização terminar', async () => {
    const db = createTestDatabase();
    const organization = new OrganizationRepository(db).create('Construtora');
    new OrganizationFilterRepository(db).save(organization.id, filters);
    const scoredBeforeSecondPage: number[] = [];
    const empty = async () => ({ items: [], nextCursor: null, hasNext: false, fetchedAt: new Date().toISOString() });

    const client: PagedOfficialSourceClient = {
      id: 'PNCP',
      listOpportunities: empty,
      listMarketObservations: empty,
      listMarketResults: empty,
      listOpportunityPages: async function* () {
        yield { items: [opportunity('a'), opportunity('b'), opportunity('c')], nextCursor: 'p2', hasNext: true, fetchedAt: new Date().toISOString() };
        const row = db.prepare('SELECT COUNT(*) AS c FROM organization_opportunity_scores WHERE organization_id = ? AND score > 0').get(organization.id) as { c: number };
        scoredBeforeSecondPage.push(row.c);
        yield { items: [opportunity('d')], nextCursor: null, hasNext: false, fetchedAt: new Date().toISOString() };
      },
      listMarketPages: async function* () {
        yield { items: [], results: [], nextCursor: null, hasNext: false, fetchedAt: new Date().toISOString() };
      },
      listMarketObservationPages: async function* () {
        yield { items: [], nextCursor: null, hasNext: false, fetchedAt: new Date().toISOString() };
      },
      listMarketResultPages: async function* () {
        yield { items: [], nextCursor: null, hasNext: false, fetchedAt: new Date().toISOString() };
      },
    };

    const runtime = new WorkerRuntime(loadEnv({ NODE_ENV: 'test', DATABASE_URL: ':memory:' }), db, {
      sourceClients: [client],
      progressiveClassificationBatch: 2,
    });
    await runtime.runCycle({ mode: 'manual', organizationId: organization.id });

    expect(scoredBeforeSecondPage[0]).toBeGreaterThanOrEqual(2);
    const total = db.prepare('SELECT COUNT(*) AS c FROM organization_opportunity_scores WHERE organization_id = ? AND score > 0').get(organization.id) as { c: number };
    expect(total.c).toBe(4);
    runtime.close();
  });
});
