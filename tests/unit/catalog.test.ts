import { describe, expect, it } from 'vitest';
import { createTestDatabase } from '../../src/db/database';
import { OrganizationRepository } from '../../src/repositories/organizationRepository';
import { OpportunityRepository } from '../../src/repositories/opportunityRepository';
import { UserRepository } from '../../src/repositories/userRepository';

describe('catálogo de licitações', () => {
  it('pesquisa, filtra por score e preserva paginação', () => {
    const db = createTestDatabase();
    const opportunities = new OpportunityRepository(db);
    const firstId = opportunities.insert({ pncpId: 'catalog-1', title: 'Software de gestão', description: 'sistema', organization: 'Órgão A', state: 'SP', sourceUrl: 'https://pncp.gov.br/1', publicationDate: '2026-08-31T10:00:00.000Z', estimatedValueCents: 1000 });
    opportunities.insert({ pncpId: 'catalog-2', title: 'Obra civil', description: '', organization: 'Órgão B', state: 'SP', sourceUrl: 'https://pncp.gov.br/2', publicationDate: '2026-08-31T10:00:00.000Z', estimatedValueCents: 1000 });
    opportunities.insert({ pncpId: 'catalog-3', title: 'Sistema de atendimento', description: 'software', organization: 'Órgão C', state: 'SP', sourceUrl: 'https://pncp.gov.br/3', publicationDate: '2026-08-31T10:00:00.000Z', estimatedValueCents: 1000 });
    opportunities.updateClassification(firstId, { score: 80, breakdown: { keyword: 80 }, source: 'rules' });

    const page = opportunities.listCatalog({ q: 'software', minScore: 70, page: 1, pageSize: 1 });

    expect(page.total).toBe(1);
    expect(page.totalPages).toBe(1);
    expect(page.data[0]?.id).toBe(firstId);
    expect(page.data[0]?.inKanban).toBe(false);
  });

  it('retorna somente os itens do kanban da organização autenticada', () => {
    const db = createTestDatabase();
    const users = new UserRepository(db);
    const organizations = new OrganizationRepository(db);
    const userA = users.create({ name: 'Ana', email: 'ana@catalog.test', passwordHash: 'hash-a' });
    const userB = users.create({ name: 'Bruno', email: 'bruno@catalog.test', passwordHash: 'hash-b' });
    const organizationA = organizations.create('Empresa A');
    const organizationB = organizations.create('Empresa B');
    organizations.addMember(organizationA.id, userA.id, 'OWNER');
    organizations.addMember(organizationB.id, userB.id, 'OWNER');
    const opportunities = new OpportunityRepository(db);
    const id = opportunities.insert({ pncpId: 'catalog-kanban-1', title: 'Licitação selecionada', description: '', organization: 'Órgão', state: 'SP', sourceUrl: 'https://pncp.gov.br/1', publicationDate: '2026-08-31T10:00:00.000Z', estimatedValueCents: 0 });

    opportunities.addToKanban(organizationA.id, id);

    expect(opportunities.listCatalog({ organizationId: organizationA.id, kanbanOnly: true }).data).toHaveLength(1);
    expect(opportunities.listCatalog({ organizationId: organizationB.id, kanbanOnly: true }).data).toHaveLength(0);
  });
});
