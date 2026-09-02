import { describe, expect, it } from 'vitest';
import { createTestDatabase } from '../../src/db/database';
import { ChecklistRepository } from '../../src/repositories/checklistRepository';
import { ChecklistService } from '../../src/services/checklistService';
import { OrganizationRepository } from '../../src/repositories/organizationRepository';
import { OpportunityRepository } from '../../src/repositories/opportunityRepository';
import { UserRepository } from '../../src/repositories/userRepository';
import { handleOpportunityChecklistGet } from '../../server/api/opportunities/[id]/checklist.get';
import { handleOpportunityChecklistPatch } from '../../server/api/opportunities/[id]/checklist/[itemId].patch';

function createOpportunity(db: ReturnType<typeof createTestDatabase>): number {
  return new OpportunityRepository(db).insert({
    pncpId: 'checklist-api-1',
    title: 'Oportunidade da API de preparacao',
    description: '',
    organization: 'Prefeitura Exemplo',
    state: 'SP',
    sourceUrl: 'https://pncp.gov.br/checklist-api-1',
    publicationDate: '2026-09-01T10:00:00.000Z',
    estimatedValueCents: 150_000,
  });
}

describe('handlers da API de checklist', () => {
  it('le o checklist somente quando a oportunidade esta no kanban da organizacao', () => {
    const db = createTestDatabase();
    const organizations = new OrganizationRepository(db);
    const first = organizations.create('Empresa Checklist API A');
    const second = organizations.create('Empresa Checklist API B');
    const opportunities = new OpportunityRepository(db);
    const opportunityId = createOpportunity(db);
    opportunities.addToKanban(first.id, opportunityId);

    const firstItems = handleOpportunityChecklistGet({ db, organizationId: first.id, opportunityId, opportunities });

    expect(firstItems).toHaveLength(10);
    expect(() => handleOpportunityChecklistGet({ db, organizationId: second.id, opportunityId, opportunities }))
      .toThrowError(expect.objectContaining({ statusCode: 404 }));
  });

  it('rejeita responsavel de outra organizacao e aceita responsavel vinculado a organizacao da oportunidade', async () => {
    const db = createTestDatabase();
    const users = new UserRepository(db);
    const organizations = new OrganizationRepository(db);
    const firstUser = users.create({ name: 'Ana', email: 'ana@checklist-api.test', passwordHash: 'hash' });
    const otherUser = users.create({ name: 'Bruno', email: 'bruno@checklist-api.test', passwordHash: 'hash' });
    const first = organizations.create('Empresa Checklist API A');
    const second = organizations.create('Empresa Checklist API B');
    organizations.addMember(first.id, firstUser.id, 'OWNER');
    organizations.addMember(second.id, otherUser.id, 'OWNER');
    const opportunities = new OpportunityRepository(db);
    const opportunityId = createOpportunity(db);
    opportunities.addToKanban(first.id, opportunityId);
    const service = new ChecklistService(new ChecklistRepository(db));
    const item = service.ensureDefaults(first.id, opportunityId)[0]!;

    await expect(handleOpportunityChecklistPatch({
      db,
      organizationId: first.id,
      opportunityId,
      itemId: item.id,
      body: { assigneeUserId: otherUser.id },
      opportunities,
    })).rejects.toThrowError(expect.objectContaining({ statusCode: 400 }));

    const updated = await handleOpportunityChecklistPatch({
      db,
      organizationId: first.id,
      opportunityId,
      itemId: item.id,
      body: { assigneeUserId: firstUser.id },
      opportunities,
    });

    expect(updated).toMatchObject({ id: item.id, assigneeUserId: firstUser.id });
  });
});
