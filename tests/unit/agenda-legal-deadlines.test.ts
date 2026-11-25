import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createTestDatabase, migrateDatabase } from '../../src/db/database';
import { businessDaysBefore, LEGAL_DEADLINE_NOTE } from '../../src/domain/legalDeadlines';
import type { OpportunityOfficialSnapshot } from '../../src/domain/operationalTypes';
import { OpportunityReminderRepository } from '../../src/repositories/opportunityReminderRepository';
import { OpportunityRepository } from '../../src/repositories/opportunityRepository';
import { OrganizationAlertPreferenceRepository } from '../../src/repositories/organizationAlertPreferenceRepository';
import { OrganizationRepository } from '../../src/repositories/organizationRepository';
import { AgendaService } from '../../src/services/agendaService';

const OPENING = '2026-09-16T13:00:00.000Z';

function insertOpportunity(db: ReturnType<typeof createTestDatabase>, pncpId: string): number {
  return new OpportunityRepository(db).insert({
    pncpId,
    title: 'Pregão',
    description: '',
    organization: 'Prefeitura Exemplo',
    state: 'SP',
    sourceUrl: `https://pncp.gov.br/${pncpId}`,
    publicationDate: '2026-09-01T10:00:00.000Z',
    estimatedValueCents: 1,
  });
}

function setup() {
  const db = createTestDatabase();
  const organization = new OrganizationRepository(db).create('Empresa Prazos Legais');
  const opportunityId = insertOpportunity(db, 'legal-1');
  new OpportunityRepository(db).addToKanban(organization.id, opportunityId);
  return { db, organization, opportunityId, agenda: new AgendaService(db), reminders: new OpportunityReminderRepository(db) };
}

function snapshot(opportunityId: number, over: Partial<OpportunityOfficialSnapshot>): OpportunityOfficialSnapshot {
  return {
    opportunityId,
    sourceCode: 'PNCP',
    biddingDeadline: null,
    sessionOpening: null,
    disputeStart: null,
    closingResult: null,
    title: 't',
    description: '',
    estimatedValueCents: 1,
    editalUrl: null,
    officialFiles: [],
    fingerprint: 'f',
    ...over,
  };
}

describe('lembretes automáticos de prazos legais', () => {
  it('cria impugnação e esclarecimentos a partir da abertura da sessão', () => {
    const { agenda, organization, opportunityId } = setup();
    const result = agenda.scheduleOfficialReminders(organization.id, undefined, snapshot(opportunityId, { sessionOpening: OPENING }));
    const due = businessDaysBefore(OPENING, 3)!;
    expect(result.map((r) => [r.type, r.title, r.dueAt, r.note, r.createdByUserId])).toEqual([
      ['MEETING', 'Abertura oficial da sessão', OPENING, null, null],
      ['CHALLENGE_DEADLINE', 'Prazo de impugnação', due, LEGAL_DEADLINE_NOTE, null],
      ['CLARIFICATION_DEADLINE', 'Prazo de esclarecimentos', due, LEGAL_DEADLINE_NOTE, null],
    ]);
  });

  it('usa biddingDeadline quando não há abertura e nada quando ambos são nulos', () => {
    const { agenda, organization, opportunityId } = setup();
    const result = agenda.scheduleOfficialReminders(organization.id, undefined, snapshot(opportunityId, { biddingDeadline: OPENING }));
    const legal = result.filter((r) => r.type === 'CHALLENGE_DEADLINE' || r.type === 'CLARIFICATION_DEADLINE');
    expect(legal).toHaveLength(2);
    expect(legal[0]!.dueAt).toBe(businessDaysBefore(OPENING, 3));

    const other = setup();
    expect(other.agenda.scheduleOfficialReminders(other.organization.id, undefined, snapshot(other.opportunityId, {}))).toEqual([]);
  });

  it('respeita preferências desligadas', () => {
    const { agenda, db, organization, opportunityId } = setup();
    new OrganizationAlertPreferenceRepository(db).save(organization.id, {
      proposalDeadline: true,
      sessionOpening: true,
      disputeStart: true,
      changeAlerts: true,
      challengeDeadline: false,
      clarificationDeadline: true,
    });
    const result = agenda.scheduleOfficialReminders(organization.id, undefined, snapshot(opportunityId, { sessionOpening: OPENING }));
    expect(result.map((r) => r.type)).toEqual(['MEETING', 'CLARIFICATION_DEADLINE']);
  });

  it('move lembretes não editados quando a abertura muda e preserva os editados', () => {
    const { agenda, reminders, organization, opportunityId } = setup();
    const first = snapshot(opportunityId, { sessionOpening: OPENING });
    agenda.scheduleOfficialReminders(organization.id, undefined, first);
    const created = reminders.listForOpportunity(organization.id, opportunityId);
    const challenge = created.find((r) => r.type === 'CHALLENGE_DEADLINE')!;
    reminders.update(organization.id, created.find((r) => r.type === 'CLARIFICATION_DEADLINE')!.id, { dueAt: '2026-09-10T15:00:00.000Z' });

    const newOpening = '2026-09-23T13:00:00.000Z';
    const result = agenda.scheduleOfficialReminders(organization.id, first, snapshot(opportunityId, { sessionOpening: newOpening }));
    const next = businessDaysBefore(newOpening, 3)!;
    expect(result.find((r) => r.type === 'CHALLENGE_DEADLINE')).toMatchObject({ id: challenge.id, dueAt: next });
    expect(result.find((r) => r.type === 'CLARIFICATION_DEADLINE')!.dueAt).toBe('2026-09-10T15:00:00.000Z');
  });

  it('migração 033 mantém lembretes antigos, índices e aceita os novos tipos', () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    migrateDatabase(db);
    // Volta ao estado pré-033: tabela original de 015 e migração desmarcada.
    db.exec('DROP TABLE opportunity_reminders');
    db.exec('ALTER TABLE organization_alert_preferences DROP COLUMN challenge_deadline_enabled');
    db.exec('ALTER TABLE organization_alert_preferences DROP COLUMN clarification_deadline_enabled');
    const migration015 = readFileSync(resolve('migrations/015_agenda_and_opportunity_changes.sql'), 'utf8');
    db.exec(migration015.split('CREATE TABLE IF NOT EXISTS opportunity_change_events')[0]!);
    const org = new OrganizationRepository(db as never).create('Empresa Migração 033');
    const opp = insertOpportunity(db as never, 'm033');
    db.prepare(`INSERT INTO opportunity_reminders (organization_id, opportunity_id, type, title, due_at, status, created_at, updated_at)
      VALUES (?, ?, 'MEETING', 'Antigo', '2026-09-10T10:00:00.000Z', 'PENDING', 'x', 'x')`).run(org.id, opp);
    db.prepare('DELETE FROM schema_migrations WHERE version = ?').run('033_legal_deadline_reminders');

    migrateDatabase(db);

    expect(db.prepare('SELECT title FROM opportunity_reminders').all()).toEqual([{ title: 'Antigo' }]);
    db.prepare(`INSERT INTO opportunity_reminders (organization_id, opportunity_id, type, title, due_at, status, created_at, updated_at)
      VALUES (?, ?, 'CHALLENGE_DEADLINE', 'Novo', '2026-09-11T10:00:00.000Z', 'PENDING', 'x', 'x')`).run(org.id, opp);
    const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'opportunity_reminders' AND name LIKE 'idx_%'").all();
    expect(indexes).toHaveLength(2);
  });
});
