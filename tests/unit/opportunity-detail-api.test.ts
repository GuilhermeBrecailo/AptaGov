import { describe, expect, it } from 'vitest';
import { createTestDatabase } from '../../src/db/database';
import { businessDaysBefore, LEGAL_DEADLINE_NOTE } from '../../src/domain/legalDeadlines';
import { sessionOpeningFromRaw } from '../../src/services/opportunityChangeService';
import { OpportunityRepository } from '../../src/repositories/opportunityRepository';
import { OpportunityReminderRepository } from '../../src/repositories/opportunityReminderRepository';
import { OrganizationRepository } from '../../src/repositories/organizationRepository';
import type { OpportunityDetailPncp } from '../../src/services/opportunityDetail/opportunityDetailService';
import { handleOpportunityDetailGet } from '../../server/api/opportunities/[id]/detail.get';

const PNCP: OpportunityDetailPncp = { source: 'pncp', items: [], itemsTotal: 0, truncated: false, files: [], fetchedAt: null, stale: false, unavailable: false };
const service = { get: async () => PNCP };

function setup(raw?: unknown, biddingDeadline: string | null = '2026-11-20T18:00:00.000Z') {
  const db = createTestDatabase();
  const org = new OrganizationRepository(db).create('Empresa Detalhe');
  const opportunities = new OpportunityRepository(db);
  const id = opportunities.insert({
    pncpId: '12345678000190-1-000123/2026', title: 'Pregão', description: '', organization: 'Órgão', state: 'SP',
    sourceUrl: 'https://pncp.gov.br/1', publicationDate: '2026-11-01T10:00:00.000Z',
    biddingDeadline: biddingDeadline ?? undefined, estimatedValueCents: 0, raw,
  });
  opportunities.addToKanban(org.id, id);
  const reminders = new OpportunityReminderRepository(db);
  const run = () => handleOpportunityDetailGet({ db, organizationId: org.id, opportunityId: id, service });
  return { db, org, id, reminders, run };
}

describe('sessionOpeningFromRaw', () => {
  it('ignora dataAberturaProposta, que no PNCP é o início do recebimento de propostas', () => {
    expect(sessionOpeningFromRaw({ dataAberturaProposta: '2026-11-24T09:00:00' })).toBeNull();
    expect(sessionOpeningFromRaw({ dataAberturaSessaoPublica: '2026-12-10T10:00:00-03:00', dataAberturaProposta: '2026-11-24T09:00:00' }))
      .toBe('2026-12-10T10:00:00-03:00');
    expect(sessionOpeningFromRaw({ dataAberturaSessao: '2026-12-11T10:00:00' })).toBe('2026-12-11T10:00:00');
  });
});

describe('GET /api/opportunities/[id]/detail', () => {
  it('retorna 404 quando a licitação não existe', async () => {
    const { db, org } = setup();
    await expect(handleOpportunityDetailGet({ db, organizationId: org.id, opportunityId: 9999, service }))
      .rejects.toMatchObject({ statusCode: 404, statusMessage: 'Licitação não encontrada' });
  });

  it('estima impugnação e esclarecimentos pela Lei 14.133 sem lembrete', async () => {
    const { run } = setup({ dataAberturaSessaoPublica: '2026-12-10T10:00:00-03:00' });
    const out = await run();
    expect(out.pncp).toEqual(PNCP);
    expect(out.opportunity.title).toBe('Pregão');
    expect(out.opportunity).not.toHaveProperty('raw');
    expect(out.deadlines.map((d) => [d.key, d.label])).toEqual([
      ['publication', 'Publicação'], ['proposalStart', 'Início das propostas'], ['proposal', 'Propostas até'],
      ['opening', 'Abertura da sessão'],
      ['challenge', 'Impugnação até'], ['clarification', 'Esclarecimentos até'],
    ]);
    const challenge = out.deadlines.find((d) => d.key === 'challenge')!;
    expect(challenge.at).toBe('2026-12-08T02:59:00.000Z');
    expect(challenge.note).toBe(LEGAL_DEADLINE_NOTE);
    expect(out.deadlines.find((d) => d.key === 'clarification')!.note).toBe(LEGAL_DEADLINE_NOTE);
    expect(out.deadlines.find((d) => d.key === 'opening')!.at).toBe('2026-12-10T10:00:00-03:00');
  });

  it('usa a data e a nota do lembrete automático da organização', async () => {
    const { run, reminders, org, id } = setup({ dataAberturaSessaoPublica: '2026-12-10T10:00:00-03:00' });
    reminders.create({ organizationId: org.id, opportunityId: id, type: 'CHALLENGE_DEADLINE', title: 'Impugnação', dueAt: '2026-12-07T20:00:00.000Z', note: 'Do edital' });
    const out = await run();
    const challenge = out.deadlines.find((d) => d.key === 'challenge')!;
    expect(challenge).toMatchObject({ at: '2026-12-07T20:00:00.000Z', note: 'Do edital' });
    expect(out.deadlines.find((d) => d.key === 'clarification')!.note).toBe(LEGAL_DEADLINE_NOTE);
  });

  it('não trata o início das propostas como abertura: estima pelo fim das propostas (registro real do PNCP)', async () => {
    const { run } = setup(
      { dataAberturaProposta: '2026-11-24T09:00:00', dataEncerramentoProposta: '2027-01-20T11:00:00' },
      '2027-01-20T11:00:00',
    );
    const out = await run();
    const find = (key: string) => out.deadlines.find((d) => d.key === key)!;
    expect(find('proposalStart').at).toBe('2026-11-24T09:00:00');
    expect(find('opening').at).toBeNull();
    expect(find('challenge').at).toBe(businessDaysBefore('2027-01-20T11:00:00', 3));
    expect(Date.parse(find('challenge').at!)).toBeGreaterThan(Date.parse('2027-01-01T00:00:00Z'));
    expect(find('challenge').note).toBe(LEGAL_DEADLINE_NOTE);
  });

  it('deixa impugnação e esclarecimentos nulos sem abertura nem fim das propostas', async () => {
    const { run } = setup(undefined, null);
    const out = await run();
    expect(out.deadlines.find((d) => d.key === 'opening')!.at).toBeNull();
    for (const key of ['challenge', 'clarification']) {
      expect(out.deadlines.find((d) => d.key === key)).toMatchObject({ at: null, note: null });
    }
  });
});
