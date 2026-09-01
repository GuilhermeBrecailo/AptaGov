import type { SqliteDatabase } from '../db/database';
import type { OpportunityOfficialSnapshot, OpportunityReminder, ReminderStatus, ReminderType } from '../domain/operationalTypes';
import { OpportunityRepository } from '../repositories/opportunityRepository';
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

export class AgendaService {
  private readonly reminders: OpportunityReminderRepository;
  private readonly opportunities: OpportunityRepository;

  constructor(db: SqliteDatabase) {
    this.reminders = new OpportunityReminderRepository(db);
    this.opportunities = new OpportunityRepository(db);
  }

  list(organizationId: number, range: OpportunityReminderRange): OpportunityReminder[] {
    return this.reminders.listForOrganization(organizationId, range);
  }

  createManual(input: ManualReminderInput): OpportunityReminder | undefined {
    if (!this.opportunities.findById(input.opportunityId)) return undefined;
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
    const existing = this.reminders.listForOpportunity(organizationId, current.opportunityId);
    const specs: Array<{
      type: ReminderType;
      title: string;
      previousDueAt: string | null;
      dueAt: string | null;
    }> = [
      { type: 'BID_DEADLINE', title: 'Prazo oficial de propostas', previousDueAt: previous?.biddingDeadline ?? null, dueAt: current.biddingDeadline },
      { type: 'MEETING', title: 'Abertura oficial da sessão', previousDueAt: previous?.sessionOpening ?? null, dueAt: current.sessionOpening },
      { type: 'FOLLOW_UP', title: 'Início oficial da disputa', previousDueAt: previous?.disputeStart ?? null, dueAt: current.disputeStart },
    ];

    return specs.flatMap((spec) => {
      if (!spec.dueAt) return [];
      const reminder = existing.find((item) => item.type === spec.type && item.createdByUserId === null);
      if (!reminder) {
        return [this.reminders.create({
          organizationId,
          opportunityId: current.opportunityId,
          type: spec.type,
          title: spec.title,
          dueAt: spec.dueAt,
          createdByUserId: null,
        })];
      }
      if (spec.previousDueAt && reminder.dueAt === spec.previousDueAt && reminder.dueAt !== spec.dueAt) {
        return [this.reminders.update(organizationId, reminder.id, { dueAt: spec.dueAt }) as OpportunityReminder];
      }
      return [reminder];
    });
  }
}

export const REMINDER_TYPES: readonly ReminderType[] = ['BID_DEADLINE', 'DOCUMENT_REVIEW', 'FOLLOW_UP', 'MEETING'];
export const REMINDER_STATUSES: readonly ReminderStatus[] = ['PENDING', 'COMPLETED', 'SKIPPED'];
