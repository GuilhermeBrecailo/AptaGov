import type { SqliteDatabase } from '../db/database';
import type { ChecklistCategory, ChecklistItem, ChecklistItemInput, ChecklistPatch, ChecklistStatus } from '../domain/operationalTypes';

interface ChecklistItemRow {
  id: number;
  organization_id: number;
  opportunity_id: number;
  title: string;
  category: ChecklistCategory;
  status: ChecklistStatus;
  assignee_user_id: number | null;
  due_at: string | null;
  note: string | null;
  position: number;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export class ChecklistRepository {
  private readonly listStatement;
  private readonly findStatement;
  private readonly insertStatement;
  private readonly updateStatement;
  private readonly ensureDefaultsTransaction;

  constructor(private readonly db: SqliteDatabase) {
    this.listStatement = db.prepare(`
      SELECT * FROM opportunity_checklist_items
      WHERE organization_id = ? AND opportunity_id = ?
      ORDER BY position ASC, id ASC
    `);
    this.findStatement = db.prepare(`
      SELECT * FROM opportunity_checklist_items
      WHERE organization_id = ? AND id = ?
    `);
    this.insertStatement = db.prepare(`
      INSERT INTO opportunity_checklist_items (
        organization_id, opportunity_id, title, category, status, assignee_user_id,
        due_at, note, position, completed_at, created_at, updated_at
      ) VALUES (
        @organizationId, @opportunityId, @title, @category, @status, @assigneeUserId,
        @dueAt, @note, @position, @completedAt, @now, @now
      )
    `);
    this.updateStatement = db.prepare(`
      UPDATE opportunity_checklist_items
      SET title = @title,
        category = @category,
        status = @status,
        assignee_user_id = @assigneeUserId,
        due_at = @dueAt,
        note = @note,
        position = @position,
        completed_at = @completedAt,
        updated_at = @updatedAt
      WHERE organization_id = @organizationId AND id = @id
    `);
    this.ensureDefaultsTransaction = db.transaction((items: ChecklistItemInput[]) => {
      for (const item of items) {
        const now = new Date().toISOString();
        this.db.prepare(`
          INSERT INTO opportunity_checklist_items (
            organization_id, opportunity_id, title, category, status, assignee_user_id,
            due_at, note, position, completed_at, created_at, updated_at
          ) VALUES (?, ?, ?, ?, 'OPEN', ?, ?, ?, ?, NULL, ?, ?)
          ON CONFLICT(organization_id, opportunity_id, title) DO NOTHING
        `).run(
          item.organizationId,
          item.opportunityId,
          item.title.trim(),
          item.category,
          item.assigneeUserId ?? null,
          item.dueAt ?? null,
          normalizeNote(item.note),
          item.position,
          now,
          now,
        );
      }
    });
  }

  list(organizationId: number, opportunityId: number): ChecklistItem[] {
    const rows = this.listStatement.all(organizationId, opportunityId) as ChecklistItemRow[];
    return rows.map(mapRow);
  }

  create(input: ChecklistItemInput): ChecklistItem {
    const now = new Date().toISOString();
    const result = this.insertStatement.run({
      organizationId: input.organizationId,
      opportunityId: input.opportunityId,
      title: input.title.trim(),
      category: input.category,
      status: 'OPEN',
      assigneeUserId: input.assigneeUserId ?? null,
      dueAt: input.dueAt ?? null,
      note: normalizeNote(input.note),
      position: input.position,
      completedAt: null,
      now,
    });
    return this.find(input.organizationId, Number(result.lastInsertRowid)) as ChecklistItem;
  }

  update(organizationId: number, id: number, patch: ChecklistPatch): ChecklistItem | undefined {
    const current = this.find(organizationId, id);
    if (!current) return undefined;
    const nextStatus = patch.status ?? current.status;
    this.updateStatement.run({
      organizationId,
      id,
      title: patch.title?.trim() ?? current.title,
      category: patch.category ?? current.category,
      status: nextStatus,
      assigneeUserId: patch.assigneeUserId === undefined ? current.assigneeUserId : patch.assigneeUserId,
      dueAt: patch.dueAt === undefined ? current.dueAt : patch.dueAt,
      note: patch.note === undefined ? current.note : normalizeNote(patch.note),
      position: patch.position ?? current.position,
      completedAt: resolveCompletedAt(nextStatus, patch.completedAt === undefined ? current.completedAt : patch.completedAt),
      updatedAt: new Date().toISOString(),
    });
    return this.find(organizationId, id);
  }

  ensureDefaults(items: ChecklistItemInput[]): void {
    if (items.length === 0) return;
    this.ensureDefaultsTransaction(items);
  }

  private find(organizationId: number, id: number): ChecklistItem | undefined {
    const row = this.findStatement.get(organizationId, id) as ChecklistItemRow | undefined;
    return row ? mapRow(row) : undefined;
  }
}

function normalizeNote(note: string | null | undefined): string | null {
  const normalized = note?.trim();
  return normalized ? normalized : null;
}

function resolveCompletedAt(status: ChecklistStatus, completedAt: string | null | undefined): string | null {
  return status === 'COMPLETED' ? completedAt ?? new Date().toISOString() : null;
}

function mapRow(row: ChecklistItemRow): ChecklistItem {
  return {
    id: row.id,
    organizationId: row.organization_id,
    opportunityId: row.opportunity_id,
    title: row.title,
    category: row.category,
    status: row.status,
    assigneeUserId: row.assignee_user_id,
    dueAt: row.due_at,
    note: row.note,
    position: row.position,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
