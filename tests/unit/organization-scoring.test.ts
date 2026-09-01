import { describe, expect, it } from 'vitest';
import { createTestDatabase } from '../../src/db/database';
import type { FilterConfig } from '../../src/domain/types';
import { OrganizationFilterRepository } from '../../src/repositories/organizationFilterRepository';
import { OrganizationRepository } from '../../src/repositories/organizationRepository';
import { OpportunityRepository } from '../../src/repositories/opportunityRepository';
import { classifyOrganizationOpportunities } from '../../src/services/scoring/classificationService';
import { PushNotificationService } from '../../src/services/pushNotificationService';

const baseFilters: FilterConfig = {
  lookbackDays: 3,
  states: ['SP'],
  citiesIbge: [],
  modalities: ['6'],
  keywords: ['software'],
  excludedKeywords: [],
  minimumScore: 0,
  estimatedValueMinCents: 0,
  scoreWeights: { keyword: 60, region: 20, value: 10, deadline: 10 },
};

describe('score por organizaÃ§Ã£o', () => {
  it('calcula e filtra a mesma oportunidade com preferÃªncias diferentes', async () => {
    const db = createTestDatabase();
    const organizations = new OrganizationRepository(db);
    const firstOrganization = organizations.create('Empresa Software');
    const secondOrganization = organizations.create('Empresa Obras');
    const opportunities = new OpportunityRepository(db);
    const opportunityId = opportunities.insert({
      pncpId: 'organization-score-1',
      title: 'Sistema de software',
      description: 'SoluÃ§Ã£o para Ã³rgÃ£o pÃºblico',
      organization: 'Ã“rgÃ£o A',
      state: 'SP',
      sourceUrl: 'https://pncp.gov.br/score-1',
      publicationDate: '2026-08-31T10:00:00.000Z',
      biddingDeadline: new Date(Date.now() + 86_400_000).toISOString(),
      estimatedValueCents: 10_000,
    });

    const filters = new OrganizationFilterRepository(db);
    filters.save(firstOrganization.id, baseFilters);
    filters.save(secondOrganization.id, {
      ...baseFilters,
      states: ['RJ'],
      keywords: ['obra'],
    });

    await classifyOrganizationOpportunities(opportunities, firstOrganization.id, baseFilters);
    await classifyOrganizationOpportunities(opportunities, secondOrganization.id, filters.find(secondOrganization.id)!);

    const firstResult = opportunities.listCatalog({ organizationId: firstOrganization.id, minScore: 90 });
    const secondResult = opportunities.listCatalog({ organizationId: secondOrganization.id, minScore: 90 });

    expect(firstResult.data[0]?.id).toBe(opportunityId);
    expect(firstResult.data[0]?.score).toBe(100);
    expect(secondResult.data).toHaveLength(0);
  });

  it('usa o score da organizaÃ§Ã£o antes de enfileirar um aviso no dispositivo', async () => {
    const db = createTestDatabase();
    const organizations = new OrganizationRepository(db);
    const secondOrganization = organizations.create('Empresa NÃ£o Aderente');
    const opportunities = new OpportunityRepository(db);
    const opportunityId = opportunities.insert({
      pncpId: 'organization-score-2',
      title: 'Sistema de software',
      description: '',
      organization: 'Ã“rgÃ£o A',
      state: 'SP',
      sourceUrl: 'https://pncp.gov.br/score-2',
      publicationDate: '2026-08-31T10:00:00.000Z',
      biddingDeadline: new Date(Date.now() + 86_400_000).toISOString(),
      estimatedValueCents: 10_000,
    });
    opportunities.updateClassification(opportunityId, {
      score: 100,
      breakdown: { keyword: 100 },
      source: 'rules',
    });
    const filters = new OrganizationFilterRepository(db);
    filters.save(secondOrganization.id, { ...baseFilters, minimumScore: 90, keywords: ['obra'], states: ['RJ'] });
    await classifyOrganizationOpportunities(opportunities, secondOrganization.id, filters.find(secondOrganization.id)!);

    const organizationsForUser = new OrganizationRepository(db);
    const user = db.prepare('INSERT INTO users (name, email, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run('UsuÃ¡rio Push', 'push-score@example.com', 'hash', new Date().toISOString(), new Date().toISOString());
    const userId = Number(user.lastInsertRowid);
    organizationsForUser.addMember(secondOrganization.id, userId, 'OWNER');
    const push = new PushNotificationService(db);
    push.registerSubscription(userId, {
      endpoint: 'https://push.example.test/organization-score',
      expirationTime: null,
      keys: { p256dh: 'p256dh-key', auth: 'auth-key' },
    });

    expect(push.queueRecent('2026-01-01T00:00:00.000Z')).toBe(0);
  });

  it('invalida o score quando a licitaÃ§Ã£o atualizada muda a classificaÃ§Ã£o', async () => {
    const db = createTestDatabase();
    const organization = new OrganizationRepository(db).create('Empresa AtualizaÃ§Ã£o');
    const opportunities = new OpportunityRepository(db);
    const filters = new OrganizationFilterRepository(db);
    const classificationFilters = { ...baseFilters, keywords: ['software'] };
    const record = {
      pncpId: 'organization-score-3',
      title: 'Sistema de software',
      description: '',
      organization: 'Ã“rgÃ£o A',
      state: 'SP',
      sourceUrl: 'https://pncp.gov.br/score-3',
      publicationDate: '2026-08-31T10:00:00.000Z',
      biddingDeadline: new Date(Date.now() + 86_400_000).toISOString(),
      estimatedValueCents: 10_000,
    };

    const opportunityId = opportunities.upsert(record).id;
    filters.save(organization.id, classificationFilters);
    await classifyOrganizationOpportunities(opportunities, organization.id, classificationFilters);
    expect(opportunities.listUnclassifiedForOrganization(organization.id)).toHaveLength(0);

    opportunities.upsert({ ...record, title: 'Obra civil' });

    expect(opportunities.listUnclassifiedForOrganization(organization.id).map((item) => item.id)).toEqual([opportunityId]);
  });
});
