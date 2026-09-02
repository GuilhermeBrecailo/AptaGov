import { describe, expect, it } from 'vitest';
import type { FilterConfig, OpportunityInput } from '../../src/domain/types';
import type { PagedOfficialSourceClient } from '../../src/integrations/sources/OfficialSourceClient';
import { loadEnv } from '../../src/config/env';
import { createTestDatabase } from '../../src/db/database';
import { JobRepository } from '../../src/repositories/jobRepository';
import { OrganizationRepository } from '../../src/repositories/organizationRepository';
import { OrganizationSyncSettingsRepository } from '../../src/repositories/organizationSyncSettingsRepository';
import { WorkerRuntime } from '../../src/workerRuntime';

const filters: FilterConfig = {
  lookbackDays: 3,
  states: [],
  citiesIbge: [],
  modalities: [],
  keywords: [],
  excludedKeywords: [],
  minimumScore: 0,
  estimatedValueMinCents: 0,
  scoreWeights: { keyword: 50, region: 20, value: 10, deadline: 20 },
};

function sourceClient(): PagedOfficialSourceClient {
  const opportunity: OpportunityInput = {
    pncpId: 'runtime-opportunity',
    source: 'PNCP',
    sourceCode: 'PNCP',
    title: 'Oportunidade do runtime',
    description: 'Fonte oficial',
    organization: 'Prefeitura',
    state: 'SP',
    city: 'Sao Paulo',
    modality: 'Pregao',
    sourceUrl: 'https://pncp.gov.br/runtime-opportunity',
    publicationDate: '2026-08-31T10:00:00.000Z',
    biddingDeadline: null,
    estimatedValueCents: 0,
  };
  return {
    id: 'PNCP',
    listOpportunities: async () => ({ items: [opportunity], nextCursor: null, hasNext: false, fetchedAt: new Date().toISOString() }),
    listMarketObservations: async () => ({ items: [], nextCursor: null, hasNext: false, fetchedAt: new Date().toISOString() }),
    listMarketResults: async () => ({ items: [], nextCursor: null, hasNext: false, fetchedAt: new Date().toISOString() }),
    listOpportunityPages: async function* () {
      yield { items: [opportunity], nextCursor: null, hasNext: false, fetchedAt: new Date().toISOString() };
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
}

describe('contrato do worker runtime', () => {
  it('preserva manual, respeita toggle automatico e cria jobs duraveis', async () => {
    const db = createTestDatabase();
    const organization = new OrganizationRepository(db).create('Empresa Runtime');
    const settings = new OrganizationSyncSettingsRepository(db);
    settings.save(organization.id, false);
    const legacyJobRepository = new JobRepository(db);
    const legacyJobId = legacyJobRepository.create('sync_and_classify');
    legacyJobRepository.markRunning(legacyJobId, 'crashed-runtime', -1);
    const runtime = new WorkerRuntime(loadEnv({ NODE_ENV: 'test', DATABASE_URL: ':memory:' }), db, {
      sourceClients: [sourceClient()],
    });

    const automatic = await runtime.runCycle({ mode: 'automatic' });
    expect(automatic.synced).toBe(0);

    const manual = await runtime.runCycle({ mode: 'manual', organizationId: organization.id });
    expect(manual.synced).toBe(1);
    expect(manual.metrics.jobsCreated).toBeGreaterThanOrEqual(3);
    expect(runtime.jobs.list('COMPLETED').map((job) => job.type)).toEqual(
      expect.arrayContaining(['source_sync', 'agenda_preparation', 'market_refresh']),
    );
    expect(runtime.jobs.find(legacyJobId)?.status).toBe('COMPLETED');
    runtime.close();
  });

  it('retoma source_sync RUNNING após reinicio sem criar outro source job', async () => {
    const db = createTestDatabase();
    const organization = new OrganizationRepository(db).create('Empresa Recovery');
    const jobRepository = new JobRepository(db);
    const jobId = jobRepository.create('source_sync', {
      organizationId: organization.id,
      radarId: null,
      filters,
      today: '2026-08-31T12:00:00.000Z',
    }, 'source_sync:automatic:1:default:recovered');
    jobRepository.markRunning(jobId, 'crashed-runtime', -1);
    const runtime = new WorkerRuntime(loadEnv({ NODE_ENV: 'test', DATABASE_URL: ':memory:' }), db, {
      sourceClients: [sourceClient()],
    });

    const result = await runtime.runCycle({ mode: 'automatic' });

    expect(result.metrics.jobsRecovered).toBe(1);
    expect(runtime.jobs.find(jobId)?.status).toBe('COMPLETED');
    expect(runtime.jobs.list().filter((job) => job.type === 'source_sync')).toHaveLength(1);
    runtime.close();
  });
});
