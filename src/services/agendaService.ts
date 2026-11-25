import type { SqliteDatabase } from '../db/database';
import type { OpportunityOfficialSnapshot, OpportunityReminder, ReminderStatus, ReminderType } from '../domain/operationalTypes';
import { businessDaysBefore, LEGAL_DEADLINE_NOTE, parseBrtDateTime } from '../domain/legalDeadlines';
import { normalizeOpportunitySnapshot } from './opportunityChangeService';
import { OpportunityRepository } from '../repositories/opportunityRepository';
import { OrganizationAlertPreferenceRepository } from '../repositories/organizationAlertPreferenceRepository';
import {
  OpportunityReminderRepository,
  type OpportunityReminderPatch,
  type OpportunityReminderRange,
} from '../repositories/opportunityReminderRepository';

export interface ManualReminderInput {
  organizationId: number;
  opportunityId: number;
  userId: number;
  type: ReminderType;
  title: string;
  dueAt: string;
  note?: string | null;
}

export type EditalDeadline = { at: string; page: number | null };
export interface EditalDeadlines {
  challenge: EditalDeadline | null;
  clarification: EditalDeadline | null;
}

const LEGAL_DEADLINE_BUSINESS_DAYS = 3;

export class AgendaService {
  private readonly reminders: OpportunityReminderRepository;
  private readonly opportunities: OpportunityRepository;
  private readonly preferences: OrganizationAlertPreferenceRepository;

  constructor(db: SqliteDatabase) {
    this.reminders = new OpportunityReminderRepository(db);
    this.opportunities = new OpportunityRepository(db);
    this.preferences = new OrganizationAlertPreferenceRepository(db);
  }

  list(organizationId: number, range: OpportunityReminderRange): OpportunityReminder[] {
    return this.reminders.listForOrganization(organizationId, range);
  }

  createManual(input: ManualReminderInput): OpportunityReminder | undefined {
    if (!this.opportunities.findById(input.opportunityId)
      || !this.reminders.hasOpportunityScope(input.organizationId, input.opportunityId)) return undefined;
    return this.reminders.create({
      organizationId: input.organizationId,
      opportunityId: input.opportunityId,
      type: input.type,
      title: input.title,
      dueAt: input.dueAt,
      note: input.note,
      createdByUserId: input.userId,
    });
  }

  update(organizationId: number, reminderId: number, patch: OpportunityReminderPatch): OpportunityReminder | undefined {
    return this.reminders.update(organizationId, reminderId, patch);
  }

  scheduleOfficialReminders(
    organizationId: number,
    previous: OpportunityOfficialSnapshot | undefined,
    current: OpportunityOfficialSnapshot,
  ): OpportunityReminder[] {
    if (!this.reminders.hasOpportunityScope(organizationId, current.opportunityId)) return [];
    const existing = this.reminders.listForOpportunity(organizationId, current.opportunityId);
    const preferences = this.preferences.find(organizationId);
    const legalBase = current.sessionOpening ?? current.biddingDeadline;
    const previousLegalBase = previous ? previous.sessionOpening ?? previous.biddingDeadline : null;
    const legalDueAt = legalBase ? businessDaysBefore(legalBase, LEGAL_DEADLINE_BUSINESS_DAYS) : null;
    const previousLegalDueAt = previousLegalBase ? businessDaysBefore(previousLegalBase, LEGAL_DEADLINE_BUSINESS_DAYS) : null;
    const specs: Array<{
      type: ReminderType;
      title: string;
      previousDueAt: string | null;
      dueAt: string | null;
      enabled: boolean;
      note?: string;
    }> = [
      { type: 'BID_DEADLINE', title: 'Prazo oficial de propostas', previousDueAt: previous?.biddingDeadline ?? null, dueAt: current.biddingDeadline, enabled: preferences.proposalDeadline },
      { type: 'MEETING', title: 'Abertura oficial da sessão', previousDueAt: previous?.sessionOpening ?? null, dueAt: current.sessionOpening, enabled: preferences.sessionOpening },
      { type: 'FOLLOW_UP', title: 'Início oficial da disputa', previousDueAt: previous?.disputeStart ?? null, dueAt: current.disputeStart, enabled: preferences.disputeStart },
      { type: 'CHALLENGE_DEADLINE', title: 'Prazo de impugnação', previousDueAt: previousLegalDueAt, dueAt: legalDueAt, enabled: preferences.challengeDeadline, note: LEGAL_DEADLINE_NOTE },
      { type: 'CLARIFICATION_DEADLINE', title: 'Prazo de esclarecimentos', previousDueAt: previousLegalDueAt, dueAt: legalDueAt, enabled: preferences.clarificationDeadline, note: LEGAL_DEADLINE_NOTE },
    ];

    return specs.flatMap((spec) => {
      if (!spec.enabled || !spec.dueAt) return [];
      const reminder = existing.find((item) => item.type === spec.type && item.createdByUserId === null);
      if (!reminder) {
        const created = this.reminders.create({
          organizationId,
          opportunityId: current.opportunityId,
          type: spec.type,
          title: spec.title,
          dueAt: spec.dueAt,
          note: spec.note,
          createdByUserId: null,
        });
        return created ? [created] : [];
      }
      if (spec.previousDueAt && reminder.dueAt === spec.previousDueAt && reminder.dueAt !== spec.dueAt) {
        const updated = this.reminders.update(organizationId, reminder.id, { dueAt: spec.dueAt });
        return updated ? [updated] : [];
      }
      return [reminder];
    });
  }

  /**
   * Replaces the legal estimate of the challenge/clarification reminders with the dates read from the
   * edital. Only an automatic reminder still holding the current legal estimate is replaced, so user
   * edits survive; with no such reminder (preference off, out of scope) nothing is created.
   */
  applyEditalDeadlines(organizationId: number, opportunityId: number, deadlines: EditalDeadlines): void {
    if (!this.reminders.hasOpportunityScope(organizationId, opportunityId)) return;
    const opportunity = this.opportunities.findById(opportunityId);
    if (!opportunity) return;
    const snapshot = normalizeOpportunitySnapshot(opportunity);
    const opening = snapshot.sessionOpening ?? snapshot.biddingDeadline;
    const legalDueAt = opening ? businessDaysBefore(opening, LEGAL_DEADLINE_BUSINESS_DAYS) : null;
    if (!legalDueAt) return;
    const existing = this.reminders.listForOpportunity(organizationId, opportunityId);
    const specs: Array<[ReminderType, EditalDeadline | null]> = [
      ['CHALLENGE_DEADLINE', deadlines.challenge],
      ['CLARIFICATION_DEADLINE', deadlines.clarification],
    ];
    for (const [type, deadline] of specs) {
      if (!deadline) continue;
      const at = parseBrtDateTime(deadline.at);
      if (!at) continue;
      const openingDate = opening ? parseBrtDateTime(opening) : null;
      if (openingDate && !(at.getTime() < openingDate.getTime())) continue;
      const reminder = existing.find((item) => item.type === type && item.createdByUserId === null);
      if (!reminder || reminder.dueAt !== legalDueAt) continue;
      const note = deadline.page === null ? 'Conforme edital' : `Conforme edital, pág. ${deadline.page}`;
      this.reminders.update(organizationId, reminder.id, { dueAt: at.toISOString(), note });
    }
  }
}

export const REMINDER_TYPES: readonly ReminderType[] = ['BID_DEADLINE', 'DOCUMENT_REVIEW', 'FOLLOW_UP', 'MEETING', 'CHALLENGE_DEADLINE', 'CLARIFICATION_DEADLINE'];
export const REMINDER_STATUSES: readonly ReminderStatus[] = ['PENDING', 'COMPLETED', 'SKIPPED'];
