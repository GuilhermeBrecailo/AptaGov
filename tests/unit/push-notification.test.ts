import { describe, expect, it } from 'vitest';
import { createTestDatabase } from '../../src/db/database';
import { OrganizationRepository } from '../../src/repositories/organizationRepository';
import { OpportunityRepository } from '../../src/repositories/opportunityRepository';
import { OrganizationSyncSettingsRepository } from '../../src/repositories/organizationSyncSettingsRepository';
import { UserRepository } from '../../src/repositories/userRepository';
import { PushNotificationService, ExpiredPushSubscriptionError, type PushSender } from '../../src/services/pushNotificationService';

const subscription = {
  endpoint: 'https://push.example.test/subscription-1',
  expirationTime: null,
  keys: { p256dh: 'p256dh-key', auth: 'auth-key' },
};

describe('notificações no dispositivo', () => {
  it('deduplica a fila por dispositivo e licitação', async () => {
    const db = createTestDatabase();
    const user = new UserRepository(db).create({ name: 'Ana', email: 'ana@push.test', passwordHash: 'hash' });
    const organization = new OrganizationRepository(db).create('Empresa Push');
    new OrganizationRepository(db).addMember(organization.id, user.id, 'OWNER');
    const opportunityId = new OpportunityRepository(db).insert({
      pncpId: 'push-1', title: 'Sistema para empresa', description: 'software', organization: 'Órgão', state: 'SP',
      sourceUrl: 'https://pncp.gov.br/1', publicationDate: '2026-08-31T10:00:00.000Z', estimatedValueCents: 10_000,
    });
    new OpportunityRepository(db).updateClassification(opportunityId, { score: 80, breakdown: { keyword: 80 }, source: 'rules' });

    const service = new PushNotificationService(db);
    service.registerSubscription(user.id, subscription);
    expect(service.queueRecent('2026-08-31T00:00:00.000Z')).toBe(1);
    expect(service.queueRecent('2026-08-31T00:00:00.000Z')).toBe(0);

    const delivered: string[] = [];
    const sender: PushSender = {
      send: async (delivery, message) => { delivered.push(`${delivery.endpoint}:${message.url}`); return {}; },
    };
    expect(await service.deliverPending(sender)).toBe(1);
    expect(delivered).toEqual(['https://push.example.test/subscription-1:https://pncp.gov.br/1']);
    expect(service.pendingCount()).toBe(0);
  });

  it('remove assinatura expirada sem repetir a entrega', async () => {
    const db = createTestDatabase();
    const user = new UserRepository(db).create({ name: 'Bia', email: 'bia@push.test', passwordHash: 'hash' });
    const organization = new OrganizationRepository(db).create('Empresa Push Expirada');
    new OrganizationRepository(db).addMember(organization.id, user.id, 'OWNER');
    const opportunityId = new OpportunityRepository(db).insert({
      pncpId: 'push-2', title: 'Manutenção', description: '', organization: 'Órgão', state: 'SP',
      sourceUrl: 'https://pncp.gov.br/2', publicationDate: '2026-08-31T10:00:00.000Z', estimatedValueCents: 0,
    });
    new OpportunityRepository(db).updateClassification(opportunityId, { score: 70, breakdown: {}, source: 'rules' });

    const service = new PushNotificationService(db);
    service.registerSubscription(user.id, { ...subscription, endpoint: 'https://push.example.test/expired' });
    service.queueRecent('2026-08-31T00:00:00.000Z');
    await expect(service.deliverPending({
      send: async () => { throw new ExpiredPushSubscriptionError(); },
    })).rejects.toBeInstanceOf(ExpiredPushSubscriptionError);
    expect(service.pendingCount()).toBe(0);
    expect(service.subscriptionCount(user.id)).toBe(0);
  });

  it('respeita o toggle automatico, mas permite alerta na sincronizacao manual', () => {
    const db = createTestDatabase();
    const user = new UserRepository(db).create({ name: 'Caio', email: 'caio@push.test', passwordHash: 'hash' });
    const organization = new OrganizationRepository(db).create('Empresa Push Manual');
    new OrganizationRepository(db).addMember(organization.id, user.id, 'OWNER');
    const opportunityId = new OpportunityRepository(db).insert({
      pncpId: 'push-3', title: 'Consultoria de tecnologia', description: 'software', organization: 'Órgão', state: 'SP',
      sourceUrl: 'https://pncp.gov.br/3', publicationDate: '2026-08-31T10:00:00.000Z', estimatedValueCents: 0,
    });
    new OpportunityRepository(db).updateClassification(opportunityId, { score: 90, breakdown: {}, source: 'rules' });

    new OrganizationSyncSettingsRepository(db).save(organization.id, false);
    const service = new PushNotificationService(db);
    service.registerSubscription(user.id, { ...subscription, endpoint: 'https://push.example.test/manual' });

    expect(service.queueRecent('2026-08-31T00:00:00.000Z', Number.POSITIVE_INFINITY, { automaticOnly: true })).toBe(0);
    expect(service.queueRecent('2026-08-31T00:00:00.000Z', Number.POSITIVE_INFINITY, { organizationId: organization.id })).toBe(1);
  });
});
