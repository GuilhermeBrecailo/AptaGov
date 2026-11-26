import { describe, expect, it } from 'vitest';
import { createTestDatabase } from '../../src/db/database';
import { OpportunityReminderRepository } from '../../src/repositories/opportunityReminderRepository';
import { OpportunityRepository } from '../../src/repositories/opportunityRepository';
import { OrganizationRepository } from '../../src/repositories/organizationRepository';
import { normalizeOpportunitySnapshot } from '../../src/services/opportunityChangeService';
import { AgendaService } from '../../src/services/agendaService';
import { editalExtractionSchema } from '../../src/services/edital/extraction';
import { businessDaysBefore } from '../../src/domain/legalDeadlines';

const OPENING = '2026-09-11T09:00:00.000Z';

function setup(options: { opening?: string | null } = {}) {
  const db = createTestDatabase();
  const organizationId = new OrganizationRepository(db).create('Empresa Edital').id;
  const opportunities = new OpportunityRepository(db);
  const opportunityId = opportunities.insert({
    pncpId: 'edital-deadlines-1',
    title: 'Obra',
    description: '',
    organization: 'Prefeitura',
    state: 'SP',
    sourceUrl: 'https://pncp.gov.br/edital-deadlines-1',
    publicationDate: '2026-09-01T10:00:00.000Z',
    estimatedValueCents: 150_000,
    ...(options.opening === null ? {} : { raw: { dataAberturaSessaoPublica: options.opening ?? OPENING } }),
  });
  opportunities.addToKanban(organizationId, opportunityId);
  const agenda = new AgendaService(db);
  const reminders = new OpportunityReminderRepository(db);
  const snapshot = normalizeOpportunitySnapshot(opportunities.findById(opportunityId)!);
  agenda.scheduleOfficialReminders(organizationId, undefined, snapshot);
  const find = (type: string) => reminders.listForOpportunity(organizationId, opportunityId).find((item) => item.type === type);
  return { agenda, reminders, organizationId, opportunityId, find };
}

describe('AgendaService.applyEditalDeadlines', () => {
  it('data do edital válida substitui o lembrete legal não editado, com a nota da página', () => {
    const { agenda, organizationId, opportunityId, find } = setup();
    agenda.applyEditalDeadlines(organizationId, opportunityId, {
      challenge: { at: '2026-09-04T17:00:00.000Z', page: 7 },
      clarification: { at: '2026-09-05T17:00:00.000Z', page: null },
    });
    expect(find('CHALLENGE_DEADLINE')).toMatchObject({ dueAt: '2026-09-04T17:00:00.000Z', note: 'Conforme edital, pág. 7' });
    expect(find('CLARIFICATION_DEADLINE')).toMatchObject({ dueAt: '2026-09-05T17:00:00.000Z', note: 'Conforme edital' });
  });

  it('lembrete editado pelo usuário é preservado', () => {
    const { agenda, reminders, organizationId, opportunityId, find } = setup();
    const challenge = find('CHALLENGE_DEADLINE')!;
    reminders.update(organizationId, challenge.id, { dueAt: '2026-09-02T12:00:00.000Z' });
    agenda.applyEditalDeadlines(organizationId, opportunityId, {
      challenge: { at: '2026-09-04T17:00:00.000Z', page: 7 },
      clarification: null,
    });
    expect(find('CHALLENGE_DEADLINE')!.dueAt).toBe('2026-09-02T12:00:00.000Z');
    expect(find('CHALLENGE_DEADLINE')!.note).toBe(challenge.note);
  });

  it('data inválida, posterior à abertura ou nula é ignorada', () => {
    const { agenda, organizationId, opportunityId, find } = setup();
    const legal = find('CHALLENGE_DEADLINE')!.dueAt;
    agenda.applyEditalDeadlines(organizationId, opportunityId, { challenge: { at: 'não é data', page: 3 }, clarification: { at: '2026-09-12T09:00:00.000Z', page: 3 } });
    agenda.applyEditalDeadlines(organizationId, opportunityId, { challenge: null, clarification: null });
    expect(find('CHALLENGE_DEADLINE')!.dueAt).toBe(legal);
    expect(find('CLARIFICATION_DEADLINE')!.dueAt).toBe(legal);
  });

  it('sem lembrete automático do tipo (preferência desligada ou fora de escopo) não cria nada', () => {
    const { agenda, organizationId, opportunityId, reminders } = setup({ opening: null });
    expect(reminders.listForOpportunity(organizationId, opportunityId).some((item) => item.type === 'CHALLENGE_DEADLINE')).toBe(false);
    agenda.applyEditalDeadlines(organizationId, opportunityId, { challenge: { at: '2026-09-04T17:00:00.000Z', page: 1 }, clarification: null });
    expect(reminders.listForOpportunity(organizationId, opportunityId).some((item) => item.type === 'CHALLENGE_DEADLINE')).toBe(false);
  });
});

describe('editalExtractionSchema com prazos', () => {
  it('extração antiga sem os campos novos continua válida e vira null', () => {
    const old = {
      summary: { object: 'x', estimatedValueCents: null, openingAt: null, modality: null, executionRegime: null, judgmentCriterion: null, allowsConsortium: null, lots: [] },
      requirements: [],
      matches: [],
    };
    const parsed = editalExtractionSchema.parse(old);
    expect(parsed.summary.challengeDeadline).toBeNull();
    expect(parsed.summary.clarificationDeadline).toBeNull();
  });

  it('datas do edital sem offset são lidas como BRT, com abertura sem offset', () => {
    const { agenda, organizationId, opportunityId, find } = setup({ opening: '2026-12-10T00:30:00' });
    expect(find('CHALLENGE_DEADLINE')!.dueAt).toBe('2026-12-08T02:59:00.000Z');
    agenda.applyEditalDeadlines(organizationId, opportunityId, {
      challenge: { at: '2026-12-07T18:00:00', page: 2 },
      clarification: { at: '2026-12-07', page: null },
    });
    expect(find('CHALLENGE_DEADLINE')!.dueAt).toBe('2026-12-07T21:00:00.000Z');
    expect(find('CLARIFICATION_DEADLINE')!.dueAt).toBe('2026-12-08T02:59:00.000Z');
  });
});

describe('Agenda com o formato real do PNCP (só início e fim das propostas)', () => {
  function setupPncp() {
    const db = createTestDatabase();
    const organizationId = new OrganizationRepository(db).create('Empresa PNCP').id;
    const opportunities = new OpportunityRepository(db);
    const opportunityId = opportunities.insert({
      pncpId: 'pncp-real-1', title: 'Obra', description: '', organization: 'Prefeitura', state: 'SP',
      sourceUrl: 'https://pncp.gov.br/pncp-real-1', publicationDate: '2026-11-23T15:06:41',
      biddingDeadline: '2027-01-20T11:00:00', estimatedValueCents: 150_000,
      raw: { dataAberturaProposta: '2026-11-24T09:00:00', dataEncerramentoProposta: '2027-01-20T11:00:00' },
    });
    opportunities.addToKanban(organizationId, opportunityId);
    const agenda = new AgendaService(db);
    const reminders = new OpportunityReminderRepository(db);
    agenda.scheduleOfficialReminders(organizationId, undefined, normalizeOpportunitySnapshot(opportunities.findById(opportunityId)!));
    const find = (type: string) => reminders.listForOpportunity(organizationId, opportunityId).find((item) => item.type === type);
    return { agenda, organizationId, opportunityId, find };
  }

  it('estima impugnação pelo fim das propostas e não cria abertura de sessão a partir do início das propostas', () => {
    const { find } = setupPncp();
    expect(find('CHALLENGE_DEADLINE')!.dueAt).toBe(businessDaysBefore('2027-01-20T11:00:00', 3));
    expect(find('MEETING')).toBeUndefined();
  });

  it('aceita a data do edital posterior ao início das propostas e anterior ao fim', () => {
    const { agenda, organizationId, opportunityId, find } = setupPncp();
    agenda.applyEditalDeadlines(organizationId, opportunityId, {
      challenge: { at: '2027-01-14T20:00:00.000Z', page: 4 },
      clarification: null,
    });
    expect(find('CHALLENGE_DEADLINE')).toMatchObject({ dueAt: '2027-01-14T20:00:00.000Z', note: 'Conforme edital, pág. 4' });
  });
});
