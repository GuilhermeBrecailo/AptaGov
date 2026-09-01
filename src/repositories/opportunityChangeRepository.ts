import type { SqliteDatabase } from '../db/database';
import type { OpportunityChangeEvent, OpportunityChangeType } from '../domain/operationalTypes';
import type { OpportunitySource } from '../domain/types';

interface OpportunityChangeEventRow {
  id: number;
  opportunity_id: number;
  source_code: OpportunitySource;
  change_type: OpportunityChangeType;
  fingerprint: string;
  summary: string;
  payload_json: string;
  detected_at: string;
  read_at: string | null;
  created_at: string;
}

export interface OpportunityChangeRecordInput {
  opportunityId: number;
  sourceCode: OpportunitySource;
  type: OpportunityChangeType;
  fingerprint: string;
  summary: string;
  payload: Record<string, unknown>;
  detectedAt: string;
}

export class OpportunityChangeRepository {
  private readonly findByUniqueStatement;
  private readonly listStatement;
  private readonly markReadStatement;
  private readonly insertStatement;
  private readonly recordTransaction;

  constructor(private readonly db: SqliteDatabase) {
    this.findByUniqueStatement = db.prepare(`
      SELECT * FROM opportunity_change_events
      WHERE opportunity_id = ? AND change_type = ? AND fingerprint = ?
    `);
    this.listStatement = db.prepare(`
      SELECT e.*
      FROM opportunity_change_events e
      WHERE EXISTS (
        SELECT 1
        FROM opportunity_reminders r
        WHERE r.organization_id = ? AND r.opportunity_id = e.opportunity_id
      )
        AND (? IS NULL OR e.opportunity_id = ?)
        AND (? = 0 OR e.read_at IS NULL)
      ORDER BY e.detected_at DESC, e.id DESC
    `);
    this.markReadStatement = db.prepare(`
      UPDATE opportunity_change_events
      SET read_at = ?
      WHERE id = ?
        AND read_at IS NULL
        AND EXISTS (
          SELECT 1
          FROM opportunity_reminders r
          WHERE r.organization_id = ? AND r.opportunity_id = opportunity_change_events.opportunity_id
        )
    `);
    this.insertStatement = db.prepare(`
      INSERT INTO opportunity_change_events (
        opportunity_id, source_code, change_type, fingerprint, summary, payload_json, detected_at, read_at, created_at
      ) VALUES (
        @opportunityId, @sourceCode, @type, @fingerprint, @summary, @payloadJson, @detectedAt, NULL, @createdAt
      )
      ON CONFLICT(opportunity_id, change_type, fingerprint) DO NOTHING
    `);
    this.recordTransaction = db.transaction((input: OpportunityChangeRecordInput) => {
      const createdAt = new Date().toISOString();
      const result = this.insertStatement.run({
        opportunityId: input.opportunityId,
        sourceCode: input.sourceCode,
        type: input.type,
        fingerprint: input.fingerprint,
        summary: input.summary.trim(),
        payloadJson: JSON.stringify(input.payload),
        detectedAt: input.detectedAt,
        createdAt,
      });
      const event = this.findByUnique(input.opportunityId, input.type, input.fingerprint) as OpportunityChangeEvent;
      return { event, created: result.changes > 0 };
    });
  }

  record(input: OpportunityChangeRecordInput): { event: OpportunityChangeEvent; created: boolean } {
    return this.recordTransaction(input);
  }

  listForOrganization(organizationId: number, opportunityId?: number, unreadOnly = false): OpportunityChangeEvent[] {
    const rows = this.listStatement.all(organizationId, opportunityId ?? null, opportunityId ?? null, unreadOnly ? 1 : 0) as OpportunityChangeEventRow[];
    return rows.map(mapRow);
  }

  markRead(organizationId: number, id: number): boolean {
    return this.markReadStatement.run(new Date().toISOString(), id, organizationId).changes > 0;
  }

  private findByUnique(opportunityId: number, type: OpportunityChangeType, fingerprint: string): OpportunityChangeEvent | undefined {
    const row = this.findByUniqueStatement.get(opportunityId, type, fingerprint) as OpportunityChangeEventRow | undefined;
    return row ? mapRow(row) : undefined;
  }
}

function mapRow(row: OpportunityChangeEventRow): OpportunityChangeEvent {
  return {
    id: row.id,
    opportunityId: row.opportunity_id,
    sourceCode: row.source_code,
    type: row.change_type,
    fingerprint: row.fingerprint,
    summary: row.summary,
    payload: JSON.parse(row.payload_json) as Record<string, unknown>,
    detectedAt: row.detected_at,
    readAt: row.read_at,
    createdAt: row.created_at,
  };
}
