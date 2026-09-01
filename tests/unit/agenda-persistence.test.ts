import { describe, expect, it } from 'vitest';
import { createTestDatabase } from '../../src/db/database';
import { OrganizationRepository } from '../../src/repositories/organizationRepository';
import { OpportunityRepository } from '../../src/repositories/opportunityRepository';
import { OpportunityChangeRepository } from '../../src/repositories/opportunityChangeRepository';
import { OpportunityReminderRepository } from '../../src/repositories/opportunityReminderRepository';

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

describe('persistência de agenda operacional', () => {
  it('mantém unicidade idempotente do lembrete por organização, oportunidade, tipo e vencimento', () => {
    const db = createTestDatabase();
    const organization = new OrganizationRepository(db).create('Empresa Agenda');
    const opportunityId = createOpportunity(db, 'agenda-1');
    const repository = new OpportunityReminderRepository(db);

    repository.create({
      organizationId: organization.id,
      opportunityId,
      type: 'BID_DEADLINE',
      title: 'Prazo final',
      dueAt: '2026-09-09T18:00:00.000Z',
      status: 'PENDING',
      note: 'Confirmar documentação',
      createdByUserId: null,
    });

    expect(repository.findIdempotent(organization.id, opportunityId, 'BID_DEADLINE', '2026-09-09T18:00:00.000Z')).toMatchObject({
      organizationId: organization.id,
      opportunityId,
      type: 'BID_DEADLINE',
      status: 'PENDING',
      title: 'Prazo final',
    });
    expect(() => repository.create({
      organizationId: organization.id,
      opportunityId,
      type: 'BID_DEADLINE',
      title: 'Prazo final duplicado',
      dueAt: '2026-09-09T18:00:00.000Z',
      status: 'PENDING',
      note: null,
      createdByUserId: null,
    })).toThrow(/unique|constraint/i);
  });

  it('permite concluir e pular lembretes sem vazar dados entre organizações', () => {
    const db = createTestDatabase();
    const organizations = new OrganizationRepository(db);
    const first = organizations.create('Empresa Operação A');
    const second = organizations.create('Empresa Operação B');
    const opportunityId = createOpportunity(db, 'agenda-2');
    const repository = new OpportunityReminderRepository(db);
    const firstReminder = repository.create({
      organizationId: first.id,
      opportunityId,
      type: 'DOCUMENT_REVIEW',
      title: 'Revisar edital',
      dueAt: '2026-09-08T15:00:00.000Z',
      status: 'PENDING',
      note: null,
      createdByUserId: null,
    });
    repository.create({
      organizationId: second.id,
      opportunityId,
      type: 'DOCUMENT_REVIEW',
      title: 'Revisar edital',
      dueAt: '2026-09-08T15:00:00.000Z',
      status: 'PENDING',
      note: null,
      createdByUserId: null,
    });

    const completed = repository.update(first.id, firstReminder.id, {
      status: 'COMPLETED',
      completedAt: '2026-09-07T12:00:00.000Z',
    });
    const skipped = repository.update(first.id, firstReminder.id, {
      status: 'SKIPPED',
      completedAt: null,
      note: 'Cliente decidiu não acompanhar',
    });

    expect(completed).toMatchObject({
      id: firstReminder.id,
      status: 'COMPLETED',
      completedAt: '2026-09-07T12:00:00.000Z',
    });
    expect(skipped).toMatchObject({
      id: firstReminder.id,
      status: 'SKIPPED',
      completedAt: null,
      note: 'Cliente decidiu não acompanhar',
    });
    expect(repository.update(second.id, firstReminder.id, { status: 'COMPLETED', completedAt: '2026-09-07T12:30:00.000Z' })).toBeUndefined();
    expect(repository.listForOrganization(first.id, {
      from: '2026-09-01T00:00:00.000Z',
      to: '2026-09-30T23:59:59.999Z',
    })).toHaveLength(1);
    expect(repository.listForOrganization(second.id, {
      from: '2026-09-01T00:00:00.000Z',
      to: '2026-09-30T23:59:59.999Z',
    })[0]).toMatchObject({
      organizationId: second.id,
      status: 'PENDING',
    });
  });

  it('deduplica eventos de mudança por fingerprint e marca leitura só na organização dona', () => {
    const db = createTestDatabase();
    const organizations = new OrganizationRepository(db);
    const first = organizations.create('Empresa Radar A');
    const second = organizations.create('Empresa Radar B');
    const opportunities = new OpportunityRepository(db);
    const firstOpportunityId = createOpportunity(db, 'agenda-3');
    const secondOpportunityId = createOpportunity(db, 'agenda-4');
    const changeRepository = new OpportunityChangeRepository(db);

    opportunities.addToKanban(first.id, firstOpportunityId);
    opportunities.addToKanban(second.id, secondOpportunityId);

    const firstInsert = changeRepository.record({
      opportunityId: firstOpportunityId,
      sourceCode: 'PNCP',
      type: 'DEADLINE_CHANGED',
      fingerprint: 'deadline:2026-09-12T18:00:00.000Z',
      summary: 'Prazo alterado para 12/09',
      payload: { from: '2026-09-10T18:00:00.000Z', to: '2026-09-12T18:00:00.000Z' },
      detectedAt: '2026-09-01T12:00:00.000Z',
    });
    const duplicateInsert = changeRepository.record({
      opportunityId: firstOpportunityId,
      sourceCode: 'PNCP',
      type: 'DEADLINE_CHANGED',
      fingerprint: 'deadline:2026-09-12T18:00:00.000Z',
      summary: 'Prazo alterado para 12/09',
      payload: { from: '2026-09-10T18:00:00.000Z', to: '2026-09-12T18:00:00.000Z' },
      detectedAt: '2026-09-01T12:05:00.000Z',
    });
    const secondInsert = changeRepository.record({
      opportunityId: secondOpportunityId,
      sourceCode: 'PNCP',
      type: 'NOTICE_UPDATED',
      fingerprint: 'notice:v2',
      summary: 'Edital republicado',
      payload: { revision: 2 },
      detectedAt: '2026-09-01T13:00:00.000Z',
    });

    expect(firstInsert.created).toBe(true);
    expect(duplicateInsert).toMatchObject({
      created: false,
      event: {
        id: firstInsert.event.id,
        summary: 'Prazo alterado para 12/09',
      },
    });
    expect(secondInsert.created).toBe(true);
    expect(changeRepository.listForOrganization(first.id)).toHaveLength(1);
    expect(changeRepository.listForOrganization(first.id, undefined, true)[0]).toMatchObject({
      opportunityId: firstOpportunityId,
      readAt: null,
    });
    expect(changeRepository.markRead(second.id, firstInsert.event.id)).toBe(false);
    expect(changeRepository.markRead(first.id, firstInsert.event.id)).toBe(true);
    expect(changeRepository.listForOrganization(first.id, firstOpportunityId, true)).toHaveLength(0);
    expect(changeRepository.listForOrganization(second.id)).toHaveLength(1);
  });

  it('mantém leitura independente por organização para a mesma oportunidade sem depender de lembretes', () => {
    const db = createTestDatabase();
    const organizations = new OrganizationRepository(db);
    const first = organizations.create('Empresa Compartilhada A');
    const second = organizations.create('Empresa Compartilhada B');
    const opportunities = new OpportunityRepository(db);
    const opportunityId = createOpportunity(db, 'agenda-5');
    const changeRepository = new OpportunityChangeRepository(db);

    opportunities.addToKanban(first.id, opportunityId);
    opportunities.addToKanban(second.id, opportunityId);

    const { event } = changeRepository.record({
      opportunityId,
      sourceCode: 'PNCP',
      type: 'STATUS_CHANGED',
      fingerprint: 'status:qualified',
      summary: 'Oportunidade qualificada',
      payload: { from: 'NEW', to: 'QUALIFIED' },
      detectedAt: '2026-09-01T14:00:00.000Z',
    });

    expect(changeRepository.listForOrganization(first.id, opportunityId, true)).toMatchObject([
      { id: event.id, readAt: null },
    ]);
    expect(changeRepository.listForOrganization(second.id, opportunityId, true)).toMatchObject([
      { id: event.id, readAt: null },
    ]);

    expect(changeRepository.markRead(first.id, event.id)).toBe(true);
    expect(changeRepository.listForOrganization(first.id, opportunityId, true)).toHaveLength(0);
    expect(changeRepository.listForOrganization(second.id, opportunityId, true)).toMatchObject([
      { id: event.id, readAt: null },
    ]);
  });
});
