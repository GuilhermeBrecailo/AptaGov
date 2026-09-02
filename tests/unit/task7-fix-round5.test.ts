import { describe, expect, it } from 'vitest';
import type { FilterConfig, OpportunityInput } from '../../src/domain/types';
import type { PagedOfficialSourceClient } from '../../src/integrations/sources/OfficialSourceClient';
import { createTestDatabase } from '../../src/db/database';
import { JobRepository } from '../../src/repositories/jobRepository';
import { OrganizationRepository } from '../../src/repositories/organizationRepository';
import { OrganizationSyncSettingsRepository } from '../../src/repositories/organizationSyncSettingsRepository';
import { buildPlatformAdminMetrics } from '../../src/services/platformAdminService';
import { WorkerRuntime } from '../../src/workerRuntime';
import { loadEnv } from '../../src/config/env';

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

function opportunity(id: string, sourceCode: 'PNCP' | 'OPEN_DATA'): OpportunityInput {
  return {
    pncpId: id,
    source: sourceCode,
    sourceCode,
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

function sourceClient(
  id: 'PNCP' | 'OPEN_DATA',
  options: { failOpportunity?: boolean; failMarket?: boolean } = {},
): PagedOfficialSourceClient {
  const empty = async () => ({ items: [], nextCursor: null, hasNext: false, fetchedAt: '2026-09-02T10:00:00.000Z' });
  return {
    id,
    listOpportunities: options.failOpportunity
      ? async () => { throw new Error(`${id} oportunidade indisponível`); }
      : async () => ({ items: [opportunity(`${id}-enabled`, id)], nextCursor: null, hasNext: false, fetchedAt: '2026-09-02T10:00:00.000Z' }),
    listMarketObservations: empty,
    listMarketResults: empty,
    listOpportunityPages: options.failOpportunity
      ? async function* () {
          yield* [];
          throw new Error(`${id} oportunidade indisponível`);
        }
      : async function* () {
          yield { items: [opportunity(`${id}-enabled`, id)], nextCursor: null, hasNext: false, fetchedAt: '2026-09-02T10:00:00.000Z' };
        },
    listMarketPages: options.failMarket
      ? async function* () {
          yield* [];
          throw new Error(`${id} mercado indisponível`);
        }
      : async function* () {
          yield { items: [], results: [], nextCursor: null, hasNext: false, fetchedAt: '2026-09-02T10:00:00.000Z' };
        },
    listMarketObservationPages: async function* () {
      yield { items: [], nextCursor: null, hasNext: false, fetchedAt: '2026-09-02T10:00:00.000Z' };
    },
    listMarketResultPages: async function* () {
      yield { items: [], nextCursor: null, hasNext: false, fetchedAt: '2026-09-02T10:00:00.000Z' };
    },
  };
}

describe('Task 7 fix round 4: toggle automático e diagnóstico de mercado', () => {
  it('deixa pending o job da organização desabilitada e executa a habilitada no mesmo ciclo', async () => {
    const db = createTestDatabase();
    const organizations = new OrganizationRepository(db);
    const disabled = organizations.create('Empresa desabilitada');
    const enabled = organizations.create('Empresa habilitada');
    const settings = new OrganizationSyncSettingsRepository(db);
    settings.save(disabled.id, false);
    settings.save(enabled.id, true);
    const jobs = new JobRepository(db);
    const disabledJobId = jobs.create('source_sync', {
      organizationId: disabled.id,
      radarId: null,
      filters,
      today: '2026-08-31T12:00:00.000Z',
      scopeKey: `organization:${disabled.id}:radar:default`,
    }, `source_sync:automatic:${disabled.id}:pending`, { organizationId: disabled.id, radarId: null });
    const runtime = new WorkerRuntime(loadEnv({ NODE_ENV: 'test', DATABASE_URL: ':memory:' }), db, {
      sourceClients: [sourceClient('PNCP')],
    });

    const cycle = await runtime.runCycle({ mode: 'automatic' });
    const enabledJob = runtime.jobs.list().find((job) => job.type === 'source_sync' && job.tenantOrganizationId === enabled.id);

    expect(runtime.jobs.find(disabledJobId)?.status).toBe('PENDING');
    expect(enabledJob).toMatchObject({ status: 'COMPLETED', tenantOrganizationId: enabled.id });
    expect(cycle.synced).toBe(1);
    runtime.close();
  });

  it('preserva falhas de todas as fontes no job, ciclo, source_runs e painel administrativo', async () => {
    const db = createTestDatabase();
    const organization = new OrganizationRepository(db).create('Empresa mercado');
    new OrganizationSyncSettingsRepository(db).save(organization.id, true);
    const env = loadEnv({ NODE_ENV: 'test', DATABASE_URL: ':memory:' });
    const runtime = new WorkerRuntime(env, db, {
      sourceClients: [
        sourceClient('PNCP', { failOpportunity: true, failMarket: true }),
        sourceClient('OPEN_DATA', { failOpportunity: true, failMarket: true }),
      ],
    });

    const cycle = await runtime.runCycle({ mode: 'automatic' });
    const marketJob = runtime.jobs.list('FAILED').find((job) => job.type === 'market_refresh');
    const marketRuns = db.prepare("SELECT source_code, status, error_category FROM source_runs WHERE flow = 'market'").all();
    const admin = buildPlatformAdminMetrics(db, env.billingPlans);

    expect(marketJob).toBeDefined();
    expect(cycle.metrics.marketRefresh?.sourceResults).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: 'PNCP', status: 'FAILED', errorCategory: 'UNAVAILABLE' }),
      expect.objectContaining({ source: 'OPEN_DATA', status: 'FAILED', errorCategory: 'UNAVAILABLE' }),
    ]));
    expect(marketRuns).toEqual(expect.arrayContaining([
      expect.objectContaining({ source_code: 'PNCP', status: 'FAILED', error_category: 'UNAVAILABLE' }),
      expect.objectContaining({ source_code: 'OPEN_DATA', status: 'FAILED', error_category: 'UNAVAILABLE' }),
    ]));
    expect(admin.worker.cycles[0]?.marketSourceResults).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: 'PNCP', status: 'FAILED', errorCategory: 'UNAVAILABLE' }),
      expect.objectContaining({ source: 'OPEN_DATA', status: 'FAILED', errorCategory: 'UNAVAILABLE' }),
    ]));
    runtime.close();
  });
});
