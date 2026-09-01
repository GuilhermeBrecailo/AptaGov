import type { SqliteDatabase } from '../db/database';

export type OpportunityFeedbackStatus = 'FAVORITED' | 'NOT_RELEVANT';

export interface OpportunityFeedback {
  organizationId: number;
  opportunityId: number;
  status: OpportunityFeedbackStatus;
  createdAt: string;
  updatedAt: string;
}

export class OpportunityFeedbackRepository {
  constructor(private readonly db: SqliteDatabase) {}

  find(organizationId: number, opportunityId: number): OpportunityFeedback | undefined {
    const row = this.db.prepare('SELECT * FROM opportunity_feedback WHERE organization_id = ? AND opportunity_id = ?')
      .get(organizationId, opportunityId) as OpportunityFeedbackRow | undefined;
    return row ? mapRow(row) : undefined;
  }

  save(organizationId: number, opportunityId: number, status: OpportunityFeedbackStatus): OpportunityFeedback {
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO opportunity_feedback (organization_id, opportunity_id, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(organization_id, opportunity_id) DO UPDATE SET status = excluded.status, updated_at = excluded.updated_at
    `).run(organizationId, opportunityId, status, now, now);
    return this.find(organizationId, opportunityId) as OpportunityFeedback;
  }

  clear(organizationId: number, opportunityId: number): boolean {
    return this.db.prepare('DELETE FROM opportunity_feedback WHERE organization_id = ? AND opportunity_id = ?')
      .run(organizationId, opportunityId).changes > 0;
  }
}

type OpportunityFeedbackRow = {
  organization_id: number;
  opportunity_id: number;
  status: OpportunityFeedbackStatus;
  created_at: string;
  updated_at: string;
};

function mapRow(row: OpportunityFeedbackRow): OpportunityFeedback {
  return {
    organizationId: row.organization_id,
    opportunityId: row.opportunity_id,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
