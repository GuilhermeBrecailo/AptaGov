import { describe, expect, it } from 'vitest';
import { createTestDatabase } from '../../src/db/database';
import { NotificationRepository } from '../../src/repositories/notificationRepository';
import { OrganizationRepository } from '../../src/repositories/organizationRepository';
import { OpportunityRepository } from '../../src/repositories/opportunityRepository';
import { UserRepository } from '../../src/repositories/userRepository';
import { NotificationService, type NotificationSender } from '../../src/services/notificationService';

describe('notificações por organização', () => {
  it('enfileira uma única entrega e marca como enviada', async () => {
    const db = createTestDatabase();
    const user = new UserRepository(db).create({ name: 'Ana', email: 'ana@notification.test', passwordHash: 'hash' });
    const organization = new OrganizationRepository(db).create('Empresa Notification');
    new OrganizationRepository(db).addMember(organization.id, user.id, 'OWNER');
    const opportunityId = new OpportunityRepository(db).insert({
      pncpId: 'notification-1', title: 'Sistema de gestão', description: 'software', organization: 'Órgão', state: 'SP',
      sourceUrl: 'https://pncp.gov.br/1', publicationDate: '2026-08-31T10:00:00.000Z', estimatedValueCents: 10_000,
    });
    new OpportunityRepository(db).updateClassification(opportunityId, { score: 80, breakdown: { keyword: 80 }, source: 'rules' });

    const notifications = new NotificationRepository(db);
    notifications.saveSettings(organization.id, { enabled: true, email: user.email });
    const service = new NotificationService(db);
    expect(service.queueRecent(organization.id, '2026-08-31T00:00:00.000Z')).toBe(1);
    expect(service.queueRecent(organization.id, '2026-08-31T00:00:00.000Z')).toBe(0);

    const sent: string[] = [];
    const sender: NotificationSender = {
      send: async (message) => { sent.push(message.to); return { providerId: 'email-1' }; },
    };
    expect(await service.deliverPending(sender)).toBe(1);
    expect(sent).toEqual([user.email]);
    expect(notifications.pendingCount(organization.id)).toBe(0);
    expect(notifications.list(organization.id)[0]?.status).toBe('SENT');
  });

  it('mantém a entrega recuperável quando o canal falha', async () => {
    const db = createTestDatabase();
    const user = new UserRepository(db).create({ name: 'Bia', email: 'bia@notification.test', passwordHash: 'hash' });
    const organization = new OrganizationRepository(db).create('Empresa Retry');
    new OrganizationRepository(db).addMember(organization.id, user.id, 'OWNER');
    const opportunityId = new OpportunityRepository(db).insert({
      pncpId: 'notification-2', title: 'Manutenção de software', description: '', organization: 'Órgão', state: 'SP',
      sourceUrl: 'https://pncp.gov.br/2', publicationDate: '2026-08-31T10:00:00.000Z', estimatedValueCents: 0,
    });
    new OpportunityRepository(db).updateClassification(opportunityId, { score: 70, breakdown: { keyword: 70 }, source: 'rules' });
    const notifications = new NotificationRepository(db);
    notifications.saveSettings(organization.id, { enabled: true, email: user.email });
    const service = new NotificationService(db);
    service.queueRecent(organization.id, '2026-08-31T00:00:00.000Z');

    await expect(service.deliverPending({ send: async () => { throw new Error('Canal indisponível'); } })).rejects.toThrow('Canal indisponível');
    expect(notifications.pendingCount(organization.id)).toBe(1);
    expect(notifications.list(organization.id)[0]?.status).toBe('FAILED');
  });

  it('enfileira somente para as organizacoes autorizadas pelo ciclo', () => {
    const db = createTestDatabase();
    const user = new UserRepository(db).create({ name: 'Caio', email: 'caio@notification.test', passwordHash: 'hash' });
    const organization = new OrganizationRepository(db).create('Empresa Notification Manual');
    new OrganizationRepository(db).addMember(organization.id, user.id, 'OWNER');
    const opportunityId = new OpportunityRepository(db).insert({
      pncpId: 'notification-3', title: 'Consultoria de tecnologia', description: 'software', organization: 'Órgão', state: 'SP',
      sourceUrl: 'https://pncp.gov.br/3', publicationDate: '2026-08-31T10:00:00.000Z', estimatedValueCents: 0,
    });
    new OpportunityRepository(db).updateClassification(opportunityId, { score: 80, breakdown: {}, source: 'rules' });
    new NotificationRepository(db).saveSettings(organization.id, { enabled: true, email: user.email });
    const service = new NotificationService(db);

    expect(service.queueRecentForOrganizations('2026-08-31T00:00:00.000Z', Number.POSITIVE_INFINITY, new Set())).toBe(0);
    expect(service.queueRecentForOrganizations('2026-08-31T00:00:00.000Z', Number.POSITIVE_INFINITY, new Set([organization.id]))).toBe(1);
  });
});
