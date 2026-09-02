import { describe, expect, it } from 'vitest';
import { createTestDatabase } from '../../src/db/database';
import { OrganizationRepository } from '../../src/repositories/organizationRepository';
import { OpportunityRepository } from '../../src/repositories/opportunityRepository';
import { UserRepository } from '../../src/repositories/userRepository';
import type { FilterConfig } from '../../src/domain/types';
import { handleOpportunitiesGet } from '../../server/api/opportunities.get';

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

  it('busca diretamente uma oportunidade autorizada sem depender da primeira pagina', () => {
    const db = createTestDatabase();
    const organizations = new OrganizationRepository(db);
    const first = organizations.create('Empresa Catalogo Direto A');
    const second = organizations.create('Empresa Catalogo Direto B');
    const opportunities = new OpportunityRepository(db);
    for (let index = 0; index < 50; index += 1) {
      const pageItemId = opportunities.insert({
        pncpId: `catalog-direct-page-${index}`,
        title: `Oportunidade da pagina inicial ${index}`,
        description: '',
        organization: 'Orgao',
        state: 'SP',
        sourceUrl: `https://pncp.gov.br/catalog-direct-page-${index}`,
        publicationDate: '2026-09-01T10:00:00.000Z',
        estimatedValueCents: 0,
      });
      opportunities.addToKanban(first.id, pageItemId);
    }
    const opportunityId = opportunities.insert({
      pncpId: 'catalog-direct-1',
      title: 'Oportunidade depois da pagina inicial',
      description: '',
      organization: 'Orgao',
      state: 'SP',
      sourceUrl: 'https://pncp.gov.br/catalog-direct-1',
      publicationDate: '2026-08-01T10:00:00.000Z',
      estimatedValueCents: 0,
    });
    opportunities.addToKanban(first.id, opportunityId);
    const firstPage = handleOpportunitiesGet({
      opportunities,
      organizationId: first.id,
      query: { page: '1', pageSize: '50', sort: 'publication', kanbanOnly: 'true' },
    });

    const direct = handleOpportunitiesGet({
      opportunities,
      organizationId: first.id,
      query: { opportunityId: String(opportunityId), kanbanOnly: 'true' },
    });
    const crossOrganization = handleOpportunitiesGet({
      opportunities,
      organizationId: second.id,
      query: { opportunityId: String(opportunityId), kanbanOnly: 'true' },
    });

    expect(firstPage.data).not.toContainEqual(expect.objectContaining({ id: opportunityId }));
    expect(direct.data.map((item) => item.id)).toEqual([opportunityId]);
    expect(crossOrganization.data).toEqual([]);
  });

  it('aplica os filtros do radar selecionado no catálogo', () => {
    const db = createTestDatabase();
    const opportunities = new OpportunityRepository(db);
    opportunities.insert({ pncpId: 'catalog-radar-software', title: 'Sistema de software', description: '', organization: 'Prefeitura SP', state: 'SP', modality: 'Pregão', sourceUrl: 'https://pncp.gov.br/catalog-radar-software', publicationDate: '2026-09-01T10:00:00.000Z', biddingDeadline: new Date(Date.now() + 86_400_000).toISOString(), estimatedValueCents: 100_000 });
    opportunities.insert({ pncpId: 'catalog-radar-obra', title: 'Obra civil', description: '', organization: 'Prefeitura SP', state: 'SP', modality: 'Pregão', sourceUrl: 'https://pncp.gov.br/catalog-radar-obra', publicationDate: '2026-09-01T10:00:00.000Z', biddingDeadline: new Date(Date.now() + 86_400_000).toISOString(), estimatedValueCents: 100_000 });
    const radarFilters: FilterConfig = { lookbackDays: 3, states: ['SP'], citiesIbge: [], modalities: ['Pregão'], keywords: ['software'], excludedKeywords: [], minimumScore: 0, estimatedValueMinCents: 0, scoreWeights: { keyword: 50, region: 20, value: 10, deadline: 20 } };

    const page = opportunities.listCatalog({ radarFilters, openDeadlineOnly: true, sort: 'deadline' });

    expect(page.data.map((item) => item.pncpId)).toEqual(['catalog-radar-software']);
  });
});
