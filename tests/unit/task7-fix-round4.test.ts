import { describe, expect, it } from 'vitest';
import { createTestDatabase } from '../../src/db/database';
import type { OpportunityInput } from '../../src/domain/types';
import { JobRepository } from '../../src/repositories/jobRepository';
import { NotificationRepository } from '../../src/repositories/notificationRepository';
import { OperationalOutboxRepository, MAX_OUTBOX_ATTEMPTS } from '../../src/repositories/operationalOutboxRepository';
import { OrganizationRepository } from '../../src/repositories/organizationRepository';
import { OpportunityRepository } from '../../src/repositories/opportunityRepository';
import { UserRepository } from '../../src/repositories/userRepository';
import { PushNotificationService } from '../../src/services/pushNotificationService';
import { NotificationService } from '../../src/services/notificationService';
import { SourceSyncRepository } from '../../src/repositories/sourceSyncRepository';

function opportunity(id: string): OpportunityInput {
  return {
    pncpId: id,
    source: 'PNCP',
    sourceCode: 'PNCP',
    title: `Oportunidade ${id}`,
    description: 'Serviço oficial',
    organization: 'Prefeitura',
    state: 'SP',
    city: 'São Paulo',
    modality: 'Pregão',
    sourceUrl: `https://pncp.gov.br/${id}`,
    publicationDate: '2026-09-02T10:00:00.000Z',
    biddingDeadline: null,
    estimatedValueCents: 0,
    raw: { id },
  };
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

describe('Task 7 fix round 3: concorrência e idempotência durável', () => {
  it('faz claim single-flight de e-mail antes de chamar o provedor', async () => {
    const db = createTestDatabase();
    const organization = new OrganizationRepository(db).create('Empresa E-mail Single Flight');
    const opportunityId = new OpportunityRepository(db).insert(opportunity('email-single-flight'));
    const repository = new NotificationRepository(db);
    repository.saveSettings(organization.id, { enabled: true, email: 'operacao@example.com' });
    repository.enqueue({
      organizationId: organization.id,
      opportunityId,
      recipient: 'operacao@example.com',
      subject: 'Aviso',
      body: 'Corpo',
      eventType: 'OPPORTUNITY_CHANGE',
      eventKey: 'event:email-single-flight',
    });

    const service = new NotificationService(db);
    const started = deferred();
    const release = deferred();
    let providerCalls = 0;
    const first = service.deliverPending({
      send: async () => {
        providerCalls += 1;
        started.resolve();
        await release.promise;
        return { providerId: 'email-provider-id' };
      },
    }, organization.id, { owner: 'email-worker-a', leaseMs: 60_000 });
    await started.promise;

    const second = await service.deliverPending({
      send: async () => {
        providerCalls += 1;
        return { providerId: 'must-not-send' };
      },
    }, organization.id, { owner: 'email-worker-b', leaseMs: 60_000 });

    release.resolve();
    expect(second).toBe(0);
    expect(await first).toBe(1);
    expect(providerCalls).toBe(1);
    expect(repository.list(organization.id)[0]).toMatchObject({ status: 'SENT', providerId: 'email-provider-id' });
  });

  it('faz claim single-flight de Web Push antes de chamar o provedor', async () => {
    const db = createTestDatabase();
    const organizations = new OrganizationRepository(db);
    const organization = organizations.create('Empresa Push Single Flight');
    const userId = new UserRepository(db).create({ name: 'Push', email: 'push-single@example.com', passwordHash: 'hash' }).id;
    organizations.addMember(organization.id, userId, 'OWNER');
    const opportunityId = new OpportunityRepository(db).insert(opportunity('push-single-flight'));
    const service = new PushNotificationService(db);
    service.registerSubscription(userId, {
      endpoint: 'https://push.example.test/single-flight',
      expirationTime: null,
      keys: { p256dh: 'p256dh', auth: 'auth' },
    });
    expect(service.queueOperationalAlert({
      organizationId: organization.id,
      opportunityId,
      title: 'Aviso',
      body: 'Corpo',
      url: 'https://pncp.gov.br/push-single-flight',
      eventType: 'OPPORTUNITY_CHANGE',
      eventKey: 'event:push-single-flight',
    })).toBe(1);

    const started = deferred();
    const release = deferred();
    let providerCalls = 0;
    const first = service.deliverPending({
      send: async () => {
        providerCalls += 1;
        started.resolve();
        await release.promise;
        return { providerId: 'push-provider-id' };
      },
    }, organization.id, { owner: 'push-worker-a', leaseMs: 60_000 });
    await started.promise;

    const second = await service.deliverPending({
      send: async () => {
        providerCalls += 1;
        return { providerId: 'must-not-send' };
      },
    }, organization.id, { owner: 'push-worker-b', leaseMs: 60_000 });

    release.resolve();
    expect(second).toBe(0);
    expect(await first).toBe(1);
    expect(providerCalls).toBe(1);
  });

  it('não reivindica reclaim de outbox stale que já atingiu o limite', () => {
    const db = createTestDatabase();
    const repository = new OperationalOutboxRepository(db);
    repository.enqueue({ eventKey: 'outbox:stale:max', eventType: 'OPPORTUNITY_SYNCED', payload: {} });
    db.prepare(`
      UPDATE worker_outbox
      SET status = 'PROCESSING', attempts = ?, lease_owner = 'crashed-worker',
          lease_until = '2000-01-01T00:00:00.000Z'
      WHERE event_key = 'outbox:stale:max'
    `).run(MAX_OUTBOX_ATTEMPTS);

    expect(repository.claimNext('new-worker', 60_000)).toBeUndefined();
    expect(repository.find(1)).toMatchObject({
      status: 'FAILED',
      attempts: MAX_OUTBOX_ATTEMPTS,
      leaseOwner: null,
      leaseUntil: null,
    });
  });

  it('rejeita mutações de job sem owner ou com owner diferente', () => {
    const db = createTestDatabase();
    const repository = new JobRepository(db);
    const jobId = repository.create('source_sync', { jobKey: 'owner-only' }, 'owner-only');
    expect(repository.claim(jobId, 'worker-a', 60_000)).toBe(true);
    expect(repository.updateCheckpoint(jobId, { cursor: 'no-owner' })).toBe(false);
    expect(repository.updateCheckpoint(jobId, { cursor: 'wrong-owner' }, 'worker-b')).toBe(false);
    expect(repository.markCompleted(jobId)).toBe(false);
    expect(repository.markFailed(jobId, 'wrong-owner')).toBe(false);
    expect(repository.updateCheckpoint(jobId, { cursor: 'page:2' }, 'worker-a')).toBe(true);
    expect(repository.markCompleted(jobId, 'worker-a')).toBe(true);
  });

  it('usa fingerprint estável para coalescer polling idêntico no outbox', () => {
    const db = createTestDatabase();
    const repository = new SourceSyncRepository(db);
    const input = {
      sourceCode: 'PNCP' as const,
      window: { dateFrom: '2026-08-30', dateTo: '2026-09-02' },
      cursor: null,
      nextCursor: null,
      scopeKey: 'organization:1:radar:default',
      organizationId: 1,
      radarId: null,
      items: [opportunity('stable-fingerprint')],
    };

    repository.persistOpportunityPage(input);
    db.prepare("UPDATE opportunities SET updated_at = '2026-09-02T10:00:01.000Z' WHERE pncp_id = 'stable-fingerprint'").run();
    repository.persistOpportunityPage(input);

    expect(db.prepare('SELECT COUNT(*) AS count FROM worker_outbox').get()).toEqual({ count: 1 });
  });
});
