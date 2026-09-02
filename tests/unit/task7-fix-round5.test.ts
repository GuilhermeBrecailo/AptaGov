import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FilterConfig, OpportunityInput } from '../../src/domain/types';
import type { PagedOfficialSourceClient } from '../../src/integrations/sources/OfficialSourceClient';
import { ResendEmailNotifier } from '../../src/integrations/notifications/ResendEmailNotifier';
import { createTestDatabase } from '../../src/db/database';
import { JobRepository } from '../../src/repositories/jobRepository';
import { NotificationRepository } from '../../src/repositories/notificationRepository';
import { OrganizationRepository } from '../../src/repositories/organizationRepository';
import { OrganizationSyncSettingsRepository } from '../../src/repositories/organizationSyncSettingsRepository';
import { OpportunityRepository } from '../../src/repositories/opportunityRepository';
import { buildPlatformAdminMetrics } from '../../src/services/platformAdminService';
import { NotificationService, type NotificationSender } from '../../src/services/notificationService';
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

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Task 7 fix round 5: toggle automático e diagnóstico de mercado', () => {
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

  it('cria source e agenda para B mesmo com jobs pendentes de A no mesmo ciclo', async () => {
    const db = createTestDatabase();
    const organizations = new OrganizationRepository(db);
    const organizationA = organizations.create('Empresa A');
    const organizationB = organizations.create('Empresa B');
    const jobs = new JobRepository(db);
    jobs.create('source_sync', { organizationId: organizationA.id, radarId: null, filters, today: '2026-09-02T10:00:00.000Z' }, 'source_sync:automatic:a:cycle', { organizationId: organizationA.id, radarId: null });
    jobs.create('agenda_preparation', { organizationId: organizationA.id }, 'agenda_preparation:a:cycle', { organizationId: organizationA.id });
    const runtime = new WorkerRuntime(loadEnv({ NODE_ENV: 'test', DATABASE_URL: ':memory:' }), db, { sourceClients: [sourceClient('PNCP')] });

    await runtime.runCycle({ mode: 'automatic' });

    expect(runtime.jobs.list().filter((job) => job.type === 'source_sync' && job.tenantOrganizationId === organizationB.id)).toHaveLength(1);
    expect(runtime.jobs.list().filter((job) => job.type === 'agenda_preparation' && job.tenantOrganizationId === organizationB.id)).toHaveLength(1);
    expect(runtime.jobs.list().find((job) => job.type === 'source_sync' && job.tenantOrganizationId === organizationB.id)?.status).toBe('COMPLETED');
    expect(runtime.jobs.list().find((job) => job.type === 'agenda_preparation' && job.tenantOrganizationId === organizationB.id)?.status).toBe('COMPLETED');
    runtime.close();
  });

  it('reutiliza a mesma chave de idempotência no retry do e-mail', async () => {
    const db = createTestDatabase();
    const organization = new OrganizationRepository(db).create('Empresa E-mail Retry');
    const opportunityId = new OpportunityRepository(db).insert({
      pncpId: 'task7-round5-email', title: 'Aviso', description: '', organization: 'Prefeitura', state: 'SP',
      sourceUrl: 'https://pncp.gov.br/task7-round5-email', publicationDate: '2026-09-02T10:00:00.000Z', estimatedValueCents: 0,
    });
    const repository = new NotificationRepository(db);
    repository.saveSettings(organization.id, { enabled: true, email: 'empresa@example.com' });
    repository.enqueue({ organizationId: organization.id, opportunityId, recipient: 'empresa@example.com', subject: 'Aviso', body: 'Corpo', eventType: 'OPPORTUNITY_CHANGE', eventKey: 'change:42' });
    const service = new NotificationService(db);
    const keys: string[] = [];
    let attempt = 0;
    const sender: NotificationSender = {
      send: async (message) => {
        keys.push(message.idempotencyKey ?? '');
        attempt += 1;
        if (attempt === 1) throw new Error('timeout após aceite');
        return { providerId: 'resend-1' };
      },
    };

    await expect(service.deliverPending(sender, undefined, { owner: 'email-round5-a' })).rejects.toThrow('timeout após aceite');
    expect(await service.deliverPending(sender, undefined, { owner: 'email-round5-b' })).toBe(1);

    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe('aptagov:email:1:1:change%3A42');
    expect(keys[1]).toBe(keys[0]);
    db.close();
  });

  it('envia a chave determinística no header do Resend', async () => {
    const requests: Request[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push(new Request(input, init));
      return new Response(JSON.stringify({ id: 'resend-1' }), { status: 200 });
    }));
    const notifier = new ResendEmailNotifier('resend-secret', 'noreply@example.com');
    await notifier.send({ to: 'empresa@example.com', subject: 'Aviso', body: 'Corpo', idempotencyKey: 'aptagov:email:1:1:change%3A42' });

    expect(requests[0]?.headers.get('Idempotency-Key')).toBe('aptagov:email:1:1:change%3A42');
    expect(requests[0]?.headers.get('Authorization')).toBe('Bearer resend-secret');
  });
});
