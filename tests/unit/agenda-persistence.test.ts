import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
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
  it('migra eventos legados convergentes sem perder eventos ou leituras', () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    const migrationsDirectory = resolve('migrations');
    for (const filename of readdirSync(migrationsDirectory).filter((name) => name.slice(0, 3) <= '017').sort()) {
      db.exec(readFileSync(resolve(migrationsDirectory, filename), 'utf8'));
    }
    const organization = new OrganizationRepository(db).create('Empresa Migração');
    const opportunityId = createOpportunity(db, 'agenda-migration');
    new OpportunityRepository(db).addToKanban(organization.id, opportunityId);
    const insert = db.prepare(`
      INSERT INTO opportunity_change_events (
        opportunity_id, source_code, change_type, fingerprint, summary,
        payload_json, detected_at, read_at, created_at
      ) VALUES (?, 'PNCP', ?, 'same-fingerprint', ?, '{}', ?, NULL, ?)
    `);
    const now = '2026-09-01T12:00:00.000Z';
    const noticeId = Number(insert.run(opportunityId, 'NOTICE_UPDATED', 'Edital atualizado', now, now).lastInsertRowid);
    insert.run(opportunityId, 'DOCUMENT_UPDATED', 'Documento atualizado', now, now);
    db.prepare(`
      INSERT INTO opportunity_change_event_reads (
        opportunity_change_event_id, organization_id, read_at, created_at
      ) VALUES (?, ?, ?, ?)
    `).run(noticeId, organization.id, now, now);

    expect(() => db.exec(readFileSync(resolve(migrationsDirectory, '018_opportunity_change_types.sql'), 'utf8'))).not.toThrow();
    expect(db.prepare('SELECT change_type, fingerprint FROM opportunity_change_events ORDER BY id').all()).toEqual([
      { change_type: 'SOURCE_UPDATE', fingerprint: 'NOTICE_UPDATED:same-fingerprint' },
      { change_type: 'SOURCE_UPDATE', fingerprint: 'DOCUMENT_UPDATED:same-fingerprint' },
    ]);
    expect(db.prepare('SELECT COUNT(*) AS count FROM opportunity_change_event_reads').get()).toEqual({ count: 1 });
    db.close();
  });

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
      type: 'PROPOSAL_DEADLINE',
      fingerprint: 'deadline:2026-09-12T18:00:00.000Z',
      summary: 'Prazo alterado para 12/09',
      payload: { from: '2026-09-10T18:00:00.000Z', to: '2026-09-12T18:00:00.000Z' },
      detectedAt: '2026-09-01T12:00:00.000Z',
    });
    const duplicateInsert = changeRepository.record({
      opportunityId: firstOpportunityId,
      sourceCode: 'PNCP',
      type: 'PROPOSAL_DEADLINE',
      fingerprint: 'deadline:2026-09-12T18:00:00.000Z',
      summary: 'Prazo alterado para 12/09',
      payload: { from: '2026-09-10T18:00:00.000Z', to: '2026-09-12T18:00:00.000Z' },
      detectedAt: '2026-09-01T12:05:00.000Z',
    });
    const secondInsert = changeRepository.record({
      opportunityId: secondOpportunityId,
      sourceCode: 'PNCP',
      type: 'SOURCE_UPDATE',
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
      type: 'CLOSING_RESULT',
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

  it('mantém evento visível e leitura independente para organização vinculada só por lembrete', () => {
    const db = createTestDatabase();
    const organizations = new OrganizationRepository(db);
    const first = organizations.create('Empresa Reminder A');
    const second = organizations.create('Empresa Reminder B');
    const opportunityId = createOpportunity(db, 'agenda-6');
    const reminders = new OpportunityReminderRepository(db);
    const changeRepository = new OpportunityChangeRepository(db);

    reminders.create({
      organizationId: first.id,
      opportunityId,
      type: 'BID_DEADLINE',
      title: 'Prazo oficial',
      dueAt: '2026-09-09T18:00:00.000Z',
      status: 'PENDING',
      note: null,
      createdByUserId: null,
    });
    reminders.create({
      organizationId: second.id,
      opportunityId,
      type: 'DOCUMENT_REVIEW',
      title: 'Ler edital',
      dueAt: '2026-09-08T15:00:00.000Z',
      status: 'PENDING',
      note: null,
      createdByUserId: null,
    });

    const { event } = changeRepository.record({
      opportunityId,
      sourceCode: 'PNCP',
      type: 'SOURCE_UPDATE',
      fingerprint: 'doc:anexo-1',
      summary: 'Anexo atualizado',
      payload: { file: 'anexo-1.pdf' },
      detectedAt: '2026-09-01T15:00:00.000Z',
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
