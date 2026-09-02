import type { AgendaEntryView, AgendaVisualType, ChecklistItem, OrganizationAlertPreferences, ReminderType } from '../types';

export interface ChecklistPresentation {
  orderedItems: ChecklistItem[];
  openItems: ChecklistItem[];
  completedItems: ChecklistItem[];
  urgentItems: ChecklistItem[];
  nextOpenItem: ChecklistItem | null;
  progressValue: number;
}

export function getKanbanItems<T extends { inKanban: boolean }>(items: T[]): T[] {
  return items.filter((item) => item.inKanban);
}

/**
 * View model de apresentacao: urgencia e proximo item orientam a leitura da tela.
 * A funcao nao decide transicoes, permissao, score ou qualquer estado de dominio.
 */
export function buildChecklistPresentation(items: ChecklistItem[], now = new Date()): ChecklistPresentation {
  const orderedItems = [...items].sort((left, right) => left.position - right.position);
  const openItems = orderedItems.filter((item) => item.status === 'OPEN');
  const completedItems = orderedItems.filter((item) => item.status === 'COMPLETED');
  const urgentItems = openItems.filter((item) => item.dueAt && isDueTodayOrEarlier(item.dueAt, now));
  const nextOpenItem = [...openItems].sort(compareChecklistItems)[0] ?? null;

  return {
    orderedItems,
    openItems,
    completedItems,
    urgentItems,
    nextOpenItem,
    progressValue: orderedItems.length ? Math.round((completedItems.length / orderedItems.length) * 100) : 0,
  };
}

export function shouldShowAgendaEntry(
  entry: AgendaEntryView,
  preferences: OrganizationAlertPreferences | null | undefined,
): boolean {
  if (!preferences) return true;
  if (entry.kind === 'REMINDER' && entry.visualType === 'MANUAL') return true;
  if (entry.kind === 'CHANGE' && !preferences.changeAlerts) return false;
  if (entry.visualType === 'BID_DEADLINE') return preferences.proposalDeadline;
  if (entry.visualType === 'MEETING') return preferences.sessionOpening;
  if (entry.visualType === 'DISPUTE') return preferences.disputeStart;
  if (entry.visualType === 'RESULT' || entry.visualType === 'SOURCE_UPDATE') return preferences.changeAlerts;
  return true;
}

export function getReminderVisualType(type: ReminderType, createdByUserId: number | null): AgendaVisualType {
  if (createdByUserId !== null) return 'MANUAL';
  if (type === 'BID_DEADLINE') return 'BID_DEADLINE';
  if (type === 'MEETING') return 'MEETING';
  if (type === 'FOLLOW_UP') return 'DISPUTE';
  return 'MANUAL';
}

function compareChecklistItems(left: ChecklistItem, right: ChecklistItem): number {
  if (left.dueAt && right.dueAt) return new Date(left.dueAt).getTime() - new Date(right.dueAt).getTime();
  if (left.dueAt) return -1;
  if (right.dueAt) return 1;
  return left.position - right.position;
}

function isDueTodayOrEarlier(value: string, now: Date): boolean {
  const due = new Date(value);
  const dueDay = new Date(due.getFullYear(), due.getMonth(), due.getDate()).getTime();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return dueDay <= today;
}
