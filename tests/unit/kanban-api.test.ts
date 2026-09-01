import { describe, expect, it } from 'vitest';
import { createTestDatabase } from '../../src/db/database';
import { ChecklistRepository } from '../../src/repositories/checklistRepository';
import { OrganizationRepository } from '../../src/repositories/organizationRepository';
import { OpportunityRepository } from '../../src/repositories/opportunityRepository';
import { UserRepository } from '../../src/repositories/userRepository';
import { addOpportunityToKanban } from '../../src/services/opportunityService';
import { ChecklistService } from '../../src/services/checklistService';

describe('kanban por organização', () => {
  it('adicionar a mesma licitação duas vezes permanece idempotente e inicializa o checklist só uma vez', () => {
    const db = createTestDatabase();
    const users = new UserRepository(db);
    const organizations = new OrganizationRepository(db);
    const user = users.create({ name: 'Ana', email: 'ana@kanban.test', passwordHash: 'hash' });
    const organization = organizations.create('Empresa Kanban');
    organizations.addMember(organization.id, user.id, 'OWNER');
    const opportunities = new OpportunityRepository(db);
    const checklist = new ChecklistService(new ChecklistRepository(db));
    const id = opportunities.insert({ pncpId: 'kanban-1', title: 'Licitação', description: '', organization: 'Órgão', state: 'SP', sourceUrl: 'https://pncp.gov.br/1', publicationDate: '2026-08-31T10:00:00.000Z', estimatedValueCents: 0 });

    addOpportunityToKanban(opportunities, checklist, organization.id, id);
    addOpportunityToKanban(opportunities, checklist, organization.id, id);

    expect(opportunities.listCatalog({ organizationId: organization.id, kanbanOnly: true }).total).toBe(1);
    expect(checklist.list(organization.id, id)).toHaveLength(10);
  });

  it('mantém checklist isolado por organização para a mesma licitação', () => {
    const db = createTestDatabase();
    const organizations = new OrganizationRepository(db);
    const first = organizations.create('Empresa Kanban A');
    const second = organizations.create('Empresa Kanban B');
    const opportunities = new OpportunityRepository(db);
    const checklist = new ChecklistService(new ChecklistRepository(db));
    const id = opportunities.insert({
      pncpId: 'kanban-2',
      title: 'Licitação compartilhada',
      description: '',
      organization: 'Órgão',
      state: 'SP',
      sourceUrl: 'https://pncp.gov.br/2',
      publicationDate: '2026-08-31T10:00:00.000Z',
      estimatedValueCents: 0,
    });

    addOpportunityToKanban(opportunities, checklist, first.id, id);
    addOpportunityToKanban(opportunities, checklist, second.id, id);
    const firstItems = checklist.list(first.id, id);
    const secondItems = checklist.list(second.id, id);
    const firstPrimary = firstItems[0]!;
    checklist.update(first.id, firstPrimary.id, { status: 'COMPLETED' });

    expect(firstItems).toHaveLength(10);
    expect(secondItems).toHaveLength(10);
    expect(checklist.list(first.id, id)[0]?.status).toBe('COMPLETED');
    expect(checklist.list(second.id, id)[0]?.status).toBe('OPEN');
  });
});
