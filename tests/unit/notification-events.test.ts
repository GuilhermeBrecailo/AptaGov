import { describe, expect, it } from 'vitest';
import { createTestDatabase } from '../../src/db/database';
import { NotificationRepository } from '../../src/repositories/notificationRepository';
import { NotificationService } from '../../src/services/notificationService';
import { OrganizationRepository } from '../../src/repositories/organizationRepository';
import { OpportunityRepository } from '../../src/repositories/opportunityRepository';
import { SavedSearchRepository } from '../../src/repositories/savedSearchRepository';
import { UserRepository } from '../../src/repositories/userRepository';
import type { FilterConfig } from '../../src/domain/types';
import { PushNotificationService } from '../../src/services/pushNotificationService';

describe('eventos de notificação', () => {
  it('deduplica por evento e não bloqueia eventos diferentes da mesma oportunidade', () => {
    const db = createTestDatabase();
    const organization = new OrganizationRepository(db).create('Empresa Eventos');
    new OpportunityRepository(db).insert({
      pncpId: 'notification-event-opportunity',
      title: 'Oportunidade',
      description: '',
      organization: 'Prefeitura',
      state: 'SP',
      sourceUrl: 'https://pncp.gov.br/notification-event-opportunity',
      publicationDate: '2026-09-01T10:00:00.000Z',
      estimatedValueCents: 0,
    });
    const repository = new NotificationRepository(db);
    const input = { organizationId: organization.id, opportunityId: 1, recipient: 'empresa@teste.com', subject: 'Aviso', body: 'Corpo' };

    expect(repository.enqueue({ ...input, eventType: 'NEW_OPPORTUNITY', eventKey: 'new_opportunity' })).toBe(true);
    expect(repository.enqueue({ ...input, eventType: 'NEW_OPPORTUNITY', eventKey: 'new_opportunity' })).toBe(false);
    expect(repository.enqueue({ ...input, eventType: 'DEADLINE_SOON', eventKey: 'deadline_48h' })).toBe(true);
    expect(repository.list(organization.id)).toHaveLength(2);
  });

  it('enfileira um alerta de prazo para oportunidade acompanhada apenas uma vez', () => {
    const db = createTestDatabase();
    const organization = new OrganizationRepository(db).create('Empresa Prazo');
    const opportunities = new OpportunityRepository(db);
    const opportunityId = opportunities.insert({
      pncpId: 'deadline-event-1',
      title: 'Sistema com prazo próximo',
      description: 'software',
      organization: 'Prefeitura',
      state: 'SP',
      sourceUrl: 'https://pncp.gov.br/deadline-event-1',
      publicationDate: '2026-09-01T10:00:00.000Z',
      biddingDeadline: '2026-09-02T10:00:00.000Z',
      estimatedValueCents: 100_000,
    });
    opportunities.updateClassification(opportunityId, { score: 80, breakdown: { keyword: 80 }, source: 'rules' });
    opportunities.addToKanban(organization.id, opportunityId);
    const notifications = new NotificationRepository(db);
    notifications.saveSettings(organization.id, { enabled: true, email: 'empresa@teste.com' });
    const service = new NotificationService(db);

    expect(service.queueUpcomingDeadlines(organization.id, '2026-09-01T10:00:00.000Z', '2026-09-03T10:00:00.000Z')).toBe(1);
    expect(service.queueUpcomingDeadlines(organization.id, '2026-09-01T10:00:00.000Z', '2026-09-03T10:00:00.000Z')).toBe(0);
    expect(notifications.list(organization.id)[0]?.subject).toContain('Prazo próximo');
  });

  it('avalia a aderência com os filtros do radar que originou o alerta', () => {
    const db = createTestDatabase();
    const organization = new OrganizationRepository(db).create('Empresa Radar Alerta');
    const opportunityId = new OpportunityRepository(db).insert({ pncpId: 'radar-notification-1', title: 'Sistema de software', description: '', organization: 'Prefeitura', state: 'SP', sourceUrl: 'https://pncp.gov.br/radar-notification-1', publicationDate: '2026-09-01T10:00:00.000Z', estimatedValueCents: 0 });
    const notifications = new NotificationRepository(db);
    notifications.saveSettings(organization.id, { enabled: true, email: 'empresa@teste.com' });
    const radarFilters: FilterConfig = { lookbackDays: 3, states: ['SP'], citiesIbge: [], modalities: ['6'], keywords: ['software'], excludedKeywords: [], minimumScore: 60, estimatedValueMinCents: 0, scoreWeights: { keyword: 60, region: 20, value: 10, deadline: 10 } };
    new SavedSearchRepository(db).create(organization.id, 'Software', radarFilters);
    const service = new NotificationService(db);

    expect(service.queueRecentForRadar(organization.id, radarFilters, '2026-09-01T00:00:00.000Z')).toBe(1);
    expect(service.queueRecentForRadar(organization.id, { ...radarFilters, keywords: ['obra'] }, '2026-09-01T00:00:00.000Z')).toBe(0);
    expect(notifications.list(organization.id)).toHaveLength(1);
    expect(notifications.list(organization.id)[0]?.opportunityId).toBe(opportunityId);
  });

  it('mantém idempotência por eventKey operacional mesmo após falha de entrega', async () => {
    const db = createTestDatabase();
    const user = new UserRepository(db).create({ name: 'Lia', email: 'lia@event.test', passwordHash: 'hash' });
    const organization = new OrganizationRepository(db).create('Empresa Evento Operacional');
    new OrganizationRepository(db).addMember(organization.id, user.id, 'OWNER');
    const opportunityId = new OpportunityRepository(db).insert({
      pncpId: 'notification-event-operational',
      title: 'Oportunidade com alteração oficial',
      description: '',
      organization: 'Prefeitura',
      state: 'SP',
      sourceUrl: 'https://pncp.gov.br/notification-event-operational',
      publicationDate: '2026-09-01T10:00:00.000Z',
      estimatedValueCents: 0,
    });
    const eventKey = `opportunity-change:${organization.id}:${opportunityId}:99`;
    const notifications = new NotificationService(db);
    const notificationRepository = new NotificationRepository(db);
    notificationRepository.saveSettings(organization.id, { enabled: true, email: user.email });
    const push = new PushNotificationService(db);
    push.registerSubscription(user.id, {
      endpoint: 'https://push.example.test/operational',
      expirationTime: null,
      keys: { p256dh: 'p256dh-key', auth: 'auth-key' },
    });

    expect(notifications.queueOperationalAlert({
      organizationId: organization.id,
      opportunityId,
      subject: 'Mudança oficial detectada',
      body: 'Prazo alterado',
      eventType: 'OPPORTUNITY_CHANGE',
      eventKey,
    })).toBe(true);
    expect(push.queueOperationalAlert({
      organizationId: organization.id,
      opportunityId,
      title: 'Mudança oficial detectada',
      body: 'Prazo alterado',
      url: 'https://pncp.gov.br/notification-event-operational',
      eventType: 'OPPORTUNITY_CHANGE',
      eventKey,
    })).toBe(1);

    await expect(notifications.deliverPending({ send: async () => { throw new Error('Canal indisponível'); } })).rejects.toThrow('Canal indisponível');
    await expect(push.deliverPending({ send: async () => { throw new Error('Push indisponível'); } })).rejects.toThrow('Push indisponível');

    expect(notifications.queueOperationalAlert({
      organizationId: organization.id,
      opportunityId,
      subject: 'Mudança oficial detectada',
      body: 'Prazo alterado',
      eventType: 'OPPORTUNITY_CHANGE',
      eventKey,
    })).toBe(false);
    expect(push.queueOperationalAlert({
      organizationId: organization.id,
      opportunityId,
      title: 'Mudança oficial detectada',
      body: 'Prazo alterado',
      url: 'https://pncp.gov.br/notification-event-operational',
      eventType: 'OPPORTUNITY_CHANGE',
      eventKey,
    })).toBe(0);
  });
});
