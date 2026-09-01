import { describe, expect, it } from 'vitest';
import { createTestDatabase } from '../../src/db/database';
import { OrganizationRepository } from '../../src/repositories/organizationRepository';
import { OpportunityRepository } from '../../src/repositories/opportunityRepository';
import { ChecklistRepository } from '../../src/repositories/checklistRepository';
import { ChecklistService } from '../../src/services/checklistService';
import { transitionOrganizationOpportunity } from '../../src/services/opportunityService';

const DEFAULT_TITLES = [
  'ler edital',
  'conferir objeto e requisitos',
  'separar documentos',
  'validar certidões',
  'validar preço e margem',
  'montar proposta',
  'revisar proposta',
  'enviar proposta',
  'preparar sessão',
  'acompanhar resultado',
];

function createOpportunity(db: ReturnType<typeof createTestDatabase>, pncpId: string): number {
  return new OpportunityRepository(db).insert({
    pncpId,
    title: `Oportunidade ${pncpId}`,
    description: '',
    organization: 'Prefeitura Exemplo',
    state: 'SP',
    sourceUrl: `https://pncp.gov.br/${pncpId}`,
    publicationDate: '2026-09-01T10:00:00.000Z',
    biddingDeadline: '2026-09-10T18:00:00.000Z',
    estimatedValueCents: 150_000,
  });
}

describe('checklist operacional', () => {
  it('cria o checklist padrão em ordem e sem duplicar quando inicializado de novo', () => {
    const db = createTestDatabase();
    const organization = new OrganizationRepository(db).create('Empresa Checklist');
    const opportunityId = createOpportunity(db, 'checklist-1');
    const service = new ChecklistService(new ChecklistRepository(db));

    const first = service.ensureDefaults(organization.id, opportunityId);
    const second = service.ensureDefaults(organization.id, opportunityId);

    expect(first.map((item) => item.title)).toEqual(DEFAULT_TITLES);
    expect(first.map((item) => item.position)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(first.map((item) => item.status)).toEqual(Array.from({ length: 10 }, () => 'OPEN'));
    expect(second.map((item) => item.id)).toEqual(first.map((item) => item.id));
  });

  it('mantém a idempotência dos defaults mesmo se um item padrão for renomeado', () => {
    const db = createTestDatabase();
    const organization = new OrganizationRepository(db).create('Empresa Checklist');
    const opportunityId = createOpportunity(db, 'checklist-rename');
    const service = new ChecklistService(new ChecklistRepository(db));

    const first = service.ensureDefaults(organization.id, opportunityId);
    const renamed = service.update(organization.id, first[0]!.id, {
      title: 'ler edital atualizado',
      note: 'Título ajustado pela operação',
    });
    const second = service.ensureDefaults(organization.id, opportunityId);

    expect(renamed).toMatchObject({
      id: first[0]!.id,
      title: 'ler edital atualizado',
    });
    expect(second).toHaveLength(10);
    expect(second.filter((item) => item.title === 'ler edital')).toHaveLength(0);
    expect(second.filter((item) => item.title === 'ler edital atualizado')).toHaveLength(1);
  });

  it('atualiza status, nota e conclusão sem vazar itens entre organizações', () => {
    const db = createTestDatabase();
    const organizations = new OrganizationRepository(db);
    const first = organizations.create('Empresa Operação A');
    const second = organizations.create('Empresa Operação B');
    const opportunityId = createOpportunity(db, 'checklist-2');
    const service = new ChecklistService(new ChecklistRepository(db));
    const firstItems = service.ensureDefaults(first.id, opportunityId);
    const secondItems = service.ensureDefaults(second.id, opportunityId);
    const firstPrimary = firstItems[0]!;
    const firstSecondary = firstItems[1]!;

    const completed = service.update(first.id, firstPrimary.id, {
      status: 'COMPLETED',
      note: 'Edital revisado',
    });
    const skipped = service.update(first.id, firstSecondary.id, {
      status: 'SKIPPED',
      note: 'Etapa dispensada',
    });

    expect(completed).toMatchObject({
      id: firstPrimary.id,
      status: 'COMPLETED',
      note: 'Edital revisado',
    });
    expect(completed?.completedAt).toBeTruthy();
    expect(skipped).toMatchObject({
      id: firstSecondary.id,
      status: 'SKIPPED',
      note: 'Etapa dispensada',
      completedAt: null,
    });
    expect(service.update(second.id, firstPrimary.id, { status: 'COMPLETED' })).toBeUndefined();
    expect(service.list(second.id, opportunityId).map((item) => item.id)).toEqual(secondItems.map((item) => item.id));
    expect(service.list(second.id, opportunityId).every((item) => item.status === 'OPEN')).toBe(true);
  });

  it('não bloqueia uma transição válida de kanban quando o checklist ainda está incompleto', () => {
    const db = createTestDatabase();
    const organizations = new OrganizationRepository(db);
    const organization = organizations.create('Empresa Fluxo');
    const opportunities = new OpportunityRepository(db);
    const checklistService = new ChecklistService(new ChecklistRepository(db));
    const opportunityId = createOpportunity(db, 'checklist-3');

    opportunities.addToKanban(organization.id, opportunityId);
    checklistService.ensureDefaults(organization.id, opportunityId);

    transitionOrganizationOpportunity(opportunities, organization.id, opportunityId, 'QUALIFIED');

    expect(opportunities.findOrganizationState(organization.id, opportunityId)).toBe('QUALIFIED');
  });
});
