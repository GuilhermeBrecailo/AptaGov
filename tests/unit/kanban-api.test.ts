import { describe, expect, it } from 'vitest';
import { createTestDatabase } from '../../src/db/database';
import { OrganizationRepository } from '../../src/repositories/organizationRepository';
import { OpportunityRepository } from '../../src/repositories/opportunityRepository';
import { UserRepository } from '../../src/repositories/userRepository';

describe('kanban por organização', () => {
  it('adicionar a mesma licitação duas vezes permanece idempotente', () => {
    const db = createTestDatabase();
    const users = new UserRepository(db);
    const organizations = new OrganizationRepository(db);
    const user = users.create({ name: 'Ana', email: 'ana@kanban.test', passwordHash: 'hash' });
    const organization = organizations.create('Empresa Kanban');
    organizations.addMember(organization.id, user.id, 'OWNER');
    const opportunities = new OpportunityRepository(db);
    const id = opportunities.insert({ pncpId: 'kanban-1', title: 'Licitação', description: '', organization: 'Órgão', state: 'SP', sourceUrl: 'https://pncp.gov.br/1', publicationDate: '2026-08-31T10:00:00.000Z', estimatedValueCents: 0 });

    opportunities.addToKanban(organization.id, id);
    opportunities.addToKanban(organization.id, id);

    expect(opportunities.listCatalog({ organizationId: organization.id, kanbanOnly: true }).total).toBe(1);
  });
});
