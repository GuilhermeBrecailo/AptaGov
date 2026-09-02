import { describe, expect, it } from 'vitest';
import { buildChecklistPresentation, shouldShowAgendaEntry } from '../../app/viewModels/operationalViewModels';
import type { AgendaEntryView, ChecklistItem, OrganizationAlertPreferences } from '../../app/types';

function checklistItem(overrides: Partial<ChecklistItem>): ChecklistItem {
  return {
    id: 1,
    organizationId: 1,
    opportunityId: 10,
    templateKey: null,
    title: 'item',
    category: 'DOCUMENTS',
    status: 'OPEN',
    assigneeUserId: null,
    dueAt: null,
    note: null,
    position: 0,
    completedAt: null,
    createdAt: '2026-09-01T12:00:00.000Z',
    updatedAt: '2026-09-01T12:00:00.000Z',
    ...overrides,
  };
}

function agendaEntry(overrides: Partial<AgendaEntryView>): AgendaEntryView {
  return {
    id: 'entry-1',
    opportunityId: 10,
    kind: 'CHANGE',
    visualType: 'SOURCE_UPDATE',
    title: 'Atualizacao oficial',
    subtitle: 'SOURCE_UPDATE',
    occurredAt: '2026-09-01T12:00:00.000Z',
    sourceLabel: 'Fonte oficial · PNCP',
    sourceUrl: 'https://pncp.gov.br/10',
    opportunityTitle: 'Oportunidade',
    statusBucket: 'OPEN',
    statusLabel: 'Mudanca oficial',
    note: null,
    canEdit: false,
    canComplete: false,
    canSkip: false,
    ...overrides,
  };
}

const allPreferences: OrganizationAlertPreferences = {
  organizationId: 1,
  proposalDeadline: true,
  sessionOpening: true,
  disputeStart: true,
  changeAlerts: true,
};

describe('view models da operacao', () => {
  it('calcula urgencia, proximo item e progresso como apresentacao da checklist', () => {
    const presentation = buildChecklistPresentation([
      checklistItem({ id: 1, title: 'vencido', position: 1, dueAt: '2026-09-01T10:00:00.000Z' }),
      checklistItem({ id: 2, title: 'futuro', position: 2, dueAt: '2026-09-05T10:00:00.000Z' }),
      checklistItem({ id: 3, title: 'concluido', position: 0, status: 'COMPLETED' }),
    ], new Date('2026-09-02T12:00:00.000Z'));

    expect(presentation.progressValue).toBe(33);
    expect(presentation.urgentItems.map((item) => item.title)).toEqual(['vencido']);
    expect(presentation.nextOpenItem?.title).toBe('vencido');
  });

  it('aplica preferencias atuais a lembretes oficiais e mudancas sem ocultar lembrete manual', () => {
    const preferences = { ...allPreferences, proposalDeadline: false, sessionOpening: false, disputeStart: false, changeAlerts: false };

    expect(shouldShowAgendaEntry(agendaEntry({ visualType: 'BID_DEADLINE' }), preferences)).toBe(false);
    expect(shouldShowAgendaEntry(agendaEntry({ visualType: 'MEETING' }), preferences)).toBe(false);
    expect(shouldShowAgendaEntry(agendaEntry({ visualType: 'DISPUTE' }), preferences)).toBe(false);
    expect(shouldShowAgendaEntry(agendaEntry({ visualType: 'RESULT' }), preferences)).toBe(false);
    expect(shouldShowAgendaEntry(agendaEntry({ visualType: 'SOURCE_UPDATE' }), preferences)).toBe(false);
    expect(shouldShowAgendaEntry(agendaEntry({ kind: 'REMINDER', visualType: 'MANUAL' }), preferences)).toBe(true);
  });
});
