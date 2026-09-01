import type { OpportunitySource } from './types';

export type ReminderType = 'BID_DEADLINE' | 'DOCUMENT_REVIEW' | 'FOLLOW_UP' | 'MEETING';
export type ReminderStatus = 'PENDING' | 'COMPLETED' | 'SKIPPED';
export type OpportunityChangeType = 'DEADLINE_CHANGED' | 'NOTICE_UPDATED' | 'STATUS_CHANGED' | 'DOCUMENT_UPDATED';

export interface OpportunityReminder {
  id: number;
  organizationId: number;
  opportunityId: number;
  type: ReminderType;
  title: string;
  dueAt: string;
  status: ReminderStatus;
  note: string | null;
  createdByUserId: number | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OpportunityChangeEvent {
  id: number;
  opportunityId: number;
  sourceCode: OpportunitySource;
  type: OpportunityChangeType;
  fingerprint: string;
  summary: string;
  payload: Record<string, unknown>;
  detectedAt: string;
  readAt: string | null;
  createdAt: string;
}
