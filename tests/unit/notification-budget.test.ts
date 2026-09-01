import { describe, expect, it } from 'vitest';
import { createTestDatabase } from '../../src/db/database';
import { NotificationRepository } from '../../src/repositories/notificationRepository';
import { NotificationBudgetRepository } from '../../src/repositories/notificationBudgetRepository';
import { OrganizationRepository } from '../../src/repositories/organizationRepository';
import { OpportunityRepository } from '../../src/repositories/opportunityRepository';
import { UserRepository } from '../../src/repositories/userRepository';
import { NotificationService } from '../../src/services/notificationService';
import { PushNotificationService } from '../../src/services/pushNotificationService';
import { BillingService } from '../../src/services/billingService';
import { OrganizationFilterRepository } from '../../src/repositories/organizationFilterRepository';

describe('orçamento de notificações', () => {
  it('limita novas entregas e contabiliza e-mail e dispositivo juntos', () => {
    const db = createTestDatabase();
    const user = new UserRepository(db).create({ name: 'Ana', email: 'ana@budget.test', passwordHash: 'hash' });
    const organization = new OrganizationRepository(db).create('Empresa Budget');
    new OrganizationRepository(db).addMember(organization.id, user.id, 'OWNER');
    const opportunities = new OpportunityRepository(db);

    for (let index = 1; index <= 2; index += 1) {
      const opportunityId = opportunities.insert({
        pncpId: `budget-${index}`, title: `Oportunidade ${index}`, description: 'software', organization: 'Órgão', state: 'SP',
        sourceUrl: `https://pncp.gov.br/${index}`, publicationDate: '2026-08-31T10:00:00.000Z', estimatedValueCents: 10_000,
      });
      opportunities.updateClassification(opportunityId, { score: 80, breakdown: { keyword: 80 }, source: 'rules' });
    }

    new NotificationRepository(db).saveSettings(organization.id, { enabled: true, email: user.email });
    const notifications = new NotificationService(db);
    expect(notifications.queueRecent(organization.id, '2026-08-30T00:00:00.000Z', 0, 1)).toBe(1);

    const push = new PushNotificationService(db);
    push.registerSubscription(user.id, {
      endpoint: 'https://push.example.test/budget',
      expirationTime: null,
      keys: { p256dh: 'p256dh-key', auth: 'auth-key' },
    });
    expect(push.queueRecent('2026-08-30T00:00:00.000Z', 1)).toBe(1);

    expect(new NotificationBudgetRepository(db).countCreatedSince('2026-08-30T00:00:00.000Z')).toBe(2);
  });

  it('bloqueia novos alertas para uma organizaÃ§Ã£o cujo trial expirou', () => {
    const db = createTestDatabase();
    const user = new UserRepository(db).create({ name: 'Ana', email: 'ana@expired.test', passwordHash: 'hash' });
    const organization = new OrganizationRepository(db).create('Empresa Expirada');
    new OrganizationRepository(db).addMember(organization.id, user.id, 'OWNER');
    const opportunityId = new OpportunityRepository(db).insert({
      pncpId: 'expired-notification-1', title: 'Oportunidade aderente', description: 'software', organization: 'Ã“rgÃ£o', state: 'SP',
      sourceUrl: 'https://pncp.gov.br/expired', publicationDate: '2026-08-31T10:00:00.000Z', estimatedValueCents: 10_000,
    });
    new OpportunityRepository(db).updateClassification(opportunityId, { score: 90, breakdown: { keyword: 90 }, source: 'rules' });
    new OrganizationFilterRepository(db).save(organization.id, {
      lookbackDays: 3, states: [], citiesIbge: [], modalities: ['6'], keywords: [], excludedKeywords: [],
      minimumScore: 80, estimatedValueMinCents: 0, scoreWeights: { keyword: 50, region: 20, value: 10, deadline: 20 },
    });
    new NotificationRepository(db).saveSettings(organization.id, { enabled: true, email: user.email });
    new BillingService(db, { trialDays: -1 }).ensureTrial(organization.id);

    const notifications = new NotificationService(db);
    expect(notifications.queueRecentForEnabledOrganizations('2026-08-30T00:00:00.000Z', 10, () => false)).toBe(0);

    const push = new PushNotificationService(db);
    push.registerSubscription(user.id, {
      endpoint: 'https://push.example.test/expired',
      expirationTime: null,
      keys: { p256dh: 'p256dh-key', auth: 'auth-key' },
    });
    expect(push.queueRecent('2026-08-30T00:00:00.000Z')).toBe(0);
  });
});
