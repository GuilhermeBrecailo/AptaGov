import { describe, expect, it } from 'vitest';
import { createTestDatabase } from '../../src/db/database';
import { OrganizationRepository } from '../../src/repositories/organizationRepository';
import { OpportunityRepository } from '../../src/repositories/opportunityRepository';
import { OpportunityFeedbackRepository } from '../../src/repositories/opportunityFeedbackRepository';

describe('feedback privado da oportunidade', () => {
  it('salva favorito de forma idempotente e mantém isolamento entre organizações', () => {
    const db = createTestDatabase();
    const organizations = new OrganizationRepository(db);
    const first = organizations.create('Empresa A');
    const second = organizations.create('Empresa B');
    const opportunityId = new OpportunityRepository(db).insert({
      pncpId: 'feedback-1',
      title: 'Software de gestão',
      description: '',
      organization: 'Prefeitura A',
      state: 'SP',
      sourceUrl: 'https://pncp.gov.br/feedback-1',
      publicationDate: '2026-09-01T10:00:00.000Z',
      estimatedValueCents: 100_000,
    });
    const repository = new OpportunityFeedbackRepository(db);

    repository.save(first.id, opportunityId, 'FAVORITED');
    repository.save(first.id, opportunityId, 'FAVORITED');

    expect(repository.find(first.id, opportunityId)?.status).toBe('FAVORITED');
    expect(repository.find(second.id, opportunityId)).toBeUndefined();
    expect(db.prepare('SELECT COUNT(*) AS count FROM opportunity_feedback').get()).toEqual({ count: 1 });
  });

  it('troca o status ou remove o feedback sem apagar a oportunidade', () => {
    const db = createTestDatabase();
    const organization = new OrganizationRepository(db).create('Empresa Feedback');
    const opportunityId = new OpportunityRepository(db).insert({
      pncpId: 'feedback-2',
      title: 'Serviço público',
      description: '',
      organization: 'Prefeitura B',
      state: 'PR',
      sourceUrl: 'https://pncp.gov.br/feedback-2',
      publicationDate: '2026-09-01T10:00:00.000Z',
      estimatedValueCents: 0,
    });
    const repository = new OpportunityFeedbackRepository(db);

    repository.save(organization.id, opportunityId, 'NOT_RELEVANT');
    repository.save(organization.id, opportunityId, 'FAVORITED');
    repository.clear(organization.id, opportunityId);

    expect(repository.find(organization.id, opportunityId)).toBeUndefined();
    expect(new OpportunityRepository(db).findById(opportunityId)?.title).toBe('Serviço público');
  });

  it('expõe favorito e esconde não relevantes somente no catálogo da própria organização', () => {
    const db = createTestDatabase();
    const organizations = new OrganizationRepository(db);
    const first = organizations.create('Empresa Catálogo A');
    const second = organizations.create('Empresa Catálogo B');
    const opportunities = new OpportunityRepository(db);
    const opportunityId = opportunities.insert({
      pncpId: 'feedback-3',
      title: 'Licitação compartilhada',
      description: '',
      organization: 'Prefeitura C',
      state: 'SP',
      sourceUrl: 'https://pncp.gov.br/feedback-3',
      publicationDate: '2026-09-01T10:00:00.000Z',
      estimatedValueCents: 0,
    });
    const feedback = new OpportunityFeedbackRepository(db);

    feedback.save(first.id, opportunityId, 'FAVORITED');
    expect(opportunities.listCatalog({ organizationId: first.id }).data[0]).toMatchObject({ favorite: true, notRelevant: false });
    expect(opportunities.listCatalog({ organizationId: second.id }).data[0]).toMatchObject({ favorite: false, notRelevant: false });

    feedback.save(first.id, opportunityId, 'NOT_RELEVANT');
    expect(opportunities.listCatalog({ organizationId: first.id }).data).toHaveLength(0);
    expect(opportunities.listCatalog({ organizationId: first.id, hideNotRelevant: false }).data[0]?.notRelevant).toBe(true);
  });
});
