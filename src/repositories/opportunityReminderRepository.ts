import type { SqliteDatabase } from '../db/database';
import type { OpportunityReminder, ReminderStatus, ReminderType } from '../domain/operationalTypes';

interface OpportunityReminderRow {
  id: number;
  organization_id: number;
  opportunity_id: number;
  type: ReminderType;
  title: string;
  due_at: string;
  status: ReminderStatus;
  note: string | null;
  created_by_user_id: number | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface OpportunityReminderRange {
  from: string;
  to: string;
}

export interface OpportunityReminderCreateInput {
  organizationId: number;
  opportunityId: number;
  type: ReminderType;
  title: string;
  dueAt: string;
  status?: ReminderStatus;
  note?: string | null;
  createdByUserId?: number | null;
  completedAt?: string | null;
}

export interface OpportunityReminderPatch {
  title?: string;
  dueAt?: string;
  status?: ReminderStatus;
  note?: string | null;
  completedAt?: string | null;
}

export class OpportunityReminderRepository {
  private readonly findByIdStatement;
  private readonly findIdempotentStatement;
  private readonly listStatement;
  private readonly listForOpportunityStatement;
  private readonly hasOpportunityScopeStatement;
  private readonly insertStatement;
  private readonly updateStatement;
  private readonly createTransaction;

  constructor(private readonly db: SqliteDatabase) {
    this.findByIdStatement = db.prepare('SELECT * FROM opportunity_reminders WHERE organization_id = ? AND id = ?');
    this.findIdempotentStatement = db.prepare(`
      SELECT * FROM opportunity_reminders
      WHERE organization_id = ? AND opportunity_id = ? AND type = ? AND due_at = ?
    `);
    this.listStatement = db.prepare(`
      SELECT * FROM opportunity_reminders
      WHERE organization_id = ? AND due_at >= ? AND due_at <= ?
      ORDER BY due_at ASC, id ASC
    `);
    this.listForOpportunityStatement = db.prepare(`
      SELECT * FROM opportunity_reminders
      WHERE organization_id = ? AND opportunity_id = ?
      ORDER BY due_at ASC, id ASC
    `);
    this.hasOpportunityScopeStatement = db.prepare(`
      SELECT 1
      WHERE EXISTS (
        SELECT 1
        FROM organization_opportunities
        WHERE organization_id = ? AND opportunity_id = ?
      ) OR EXISTS (
        SELECT 1
        FROM opportunity_reminders
        WHERE organization_id = ? AND opportunity_id = ?
      )
    `);
    this.insertStatement = db.prepare(`
      INSERT INTO opportunity_reminders (
        organization_id, opportunity_id, type, title, due_at, status, note,
        created_by_user_id, completed_at, created_at, updated_at
      ) VALUES (
        @organizationId, @opportunityId, @type, @title, @dueAt, @status, @note,
        @createdByUserId, @completedAt, @now, @now
      )
    `);
    this.updateStatement = db.prepare(`
      UPDATE opportunity_reminders
      SET title = @title,
        due_at = @dueAt,
        status = @status,
        note = @note,
        completed_at = @completedAt,
        updated_at = @updatedAt
      WHERE organization_id = @organizationId AND id = @id
    `);
    this.createTransaction = db.transaction((input: OpportunityReminderCreateInput) => {
      const now = new Date().toISOString();
      const result = this.insertStatement.run({
        organizationId: input.organizationId,
        opportunityId: input.opportunityId,
        type: input.type,
        title: input.title.trim(),
        dueAt: input.dueAt,
        status: input.status ?? 'PENDING',
        note: normalizeNote(input.note),
        createdByUserId: input.createdByUserId ?? null,
        completedAt: resolveCompletedAt(input.status ?? 'PENDING', input.completedAt),
        now,
      });
      return this.find(input.organizationId, Number(result.lastInsertRowid)) as OpportunityReminder;
    });
  }

  listForOrganization(organizationId: number, range: OpportunityReminderRange): OpportunityReminder[] {
    const rows = this.listStatement.all(organizationId, range.from, range.to) as OpportunityReminderRow[];
    return rows.map(mapRow);
  }

  listForOpportunity(organizationId: number, opportunityId: number): OpportunityReminder[] {
    const rows = this.listForOpportunityStatement.all(organizationId, opportunityId) as OpportunityReminderRow[];
    return rows.map(mapRow);
  }

  create(input: OpportunityReminderCreateInput): OpportunityReminder | undefined {
    if (!this.hasOpportunityScope(input.organizationId, input.opportunityId)) return undefined;
    return this.createTransaction(input);
  }

  update(organizationId: number, id: number, patch: OpportunityReminderPatch): OpportunityReminder | undefined {
    const current = this.find(organizationId, id);
    if (!current || !this.hasOpportunityScope(organizationId, current.opportunityId)) return undefined;
    const nextStatus = patch.status ?? current.status;
    this.updateStatement.run({
      organizationId,
      id,
      title: patch.title?.trim() ?? current.title,
      dueAt: patch.dueAt ?? current.dueAt,
      status: nextStatus,
      note: patch.note === undefined ? current.note : normalizeNote(patch.note),
      completedAt: resolveCompletedAt(nextStatus, patch.completedAt === undefined ? current.completedAt : patch.completedAt),
      updatedAt: new Date().toISOString(),
    });
    return this.find(organizationId, id);
  }

  findIdempotent(organizationId: number, opportunityId: number, type: ReminderType, dueAt: string): OpportunityReminder | undefined {
    const row = this.findIdempotentStatement.get(organizationId, opportunityId, type, dueAt) as OpportunityReminderRow | undefined;
    return row ? mapRow(row) : undefined;
  }

  hasOpportunityScope(organizationId: number, opportunityId: number): boolean {
    return Boolean(this.hasOpportunityScopeStatement.get(organizationId, opportunityId, organizationId, opportunityId));
  }

  private find(organizationId: number, id: number): OpportunityReminder | undefined {
    const row = this.findByIdStatement.get(organizationId, id) as OpportunityReminderRow | undefined;
    return row ? mapRow(row) : undefined;
  }
}

function normalizeNote(note: string | null | undefined): string | null {
  const normalized = note?.trim();
  return normalized ? normalized : null;
}

function resolveCompletedAt(status: ReminderStatus, completedAt: string | null | undefined): string | null {
  return status === 'COMPLETED' ? completedAt ?? new Date().toISOString() : null;
}

function mapRow(row: OpportunityReminderRow): OpportunityReminder {
  return {
    id: row.id,
    organizationId: row.organization_id,
    opportunityId: row.opportunity_id,
    type: row.type,
    title: row.title,
    dueAt: row.due_at,
    status: row.status,
    note: row.note,
    createdByUserId: row.created_by_user_id,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
