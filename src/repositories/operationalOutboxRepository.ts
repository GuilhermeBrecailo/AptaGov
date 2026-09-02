import type { SqliteDatabase } from '../db/database';

export type OutboxStatus = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';

export interface OperationalOutboxEvent<T = unknown> {
  id: number;
  eventKey: string;
  eventType: string;
  organizationId: number | null;
  radarId: number | null;
  payload: T;
  status: OutboxStatus;
  attempts: number;
  leaseOwner: string | null;
  leaseUntil: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface EnqueueOutboxInput {
  eventKey: string;
  eventType: string;
  organizationId?: number | null;
  radarId?: number | null;
  payload: unknown;
}

export class OperationalOutboxRepository {
  constructor(private readonly db: SqliteDatabase) {}

  enqueue(input: EnqueueOutboxInput): boolean {
    const now = new Date().toISOString();
    return this.db.prepare(`
      INSERT INTO worker_outbox (
        event_key, event_type, organization_id, radar_id, payload_json, status, attempts, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'PENDING', 0, ?, ?)
      ON CONFLICT(event_key) DO NOTHING
    `).run(
      input.eventKey,
      input.eventType,
      input.organizationId ?? null,
      input.radarId ?? null,
      JSON.stringify(input.payload),
      now,
      now,
    ).changes > 0;
  }

  list(status?: OutboxStatus, organizationId?: number): OperationalOutboxEvent[] {
    const conditions: string[] = [];
    const params: Array<string | number> = [];
    if (status) {
      conditions.push('status = ?');
      params.push(status);
    }
    if (organizationId !== undefined) {
      conditions.push('organization_id = ?');
      params.push(organizationId);
    }
    const where = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '';
    const rows = this.db.prepare(`SELECT * FROM worker_outbox${where} ORDER BY id ASC`).all(...params) as OutboxRow[];
    return rows.map(mapRow);
  }

  listPending(organizationId?: number): OperationalOutboxEvent[] {
    return this.list(undefined, organizationId).filter((event) => event.status === 'PENDING' || event.status === 'FAILED');
  }

  claimNext(owner: string, leaseMs: number, organizationId?: number): OperationalOutboxEvent | undefined {
    const now = new Date();
    const nowIso = now.toISOString();
    const leaseUntil = new Date(now.getTime() + Math.max(0, leaseMs)).toISOString();
    const scope = organizationId === undefined ? '' : ' AND organization_id = ?';
    const params: Array<string | number> = [nowIso];
    if (organizationId !== undefined) params.push(organizationId);
    const event = this.db.transaction(() => {
      const row = this.db.prepare(`
        SELECT id FROM worker_outbox
        WHERE status IN ('PENDING', 'FAILED', 'PROCESSING')
          AND (lease_until IS NULL OR lease_until <= ?)
          ${scope}
        ORDER BY id ASC LIMIT 1
      `).get(...params) as { id: number } | undefined;
      if (!row) return undefined;
      const updated = this.db.prepare(`
        UPDATE worker_outbox
        SET status = 'PROCESSING', lease_owner = ?, lease_until = ?, attempts = attempts + 1, updated_at = ?
        WHERE id = ? AND status IN ('PENDING', 'FAILED', 'PROCESSING') AND (lease_until IS NULL OR lease_until <= ?)
      `).run(owner, leaseUntil, nowIso, row.id, nowIso);
      return updated.changes > 0 ? this.find(row.id) : undefined;
    })();
    return event;
  }

  complete(id: number, owner?: string): boolean {
    const now = new Date().toISOString();
    const params: Array<string | number> = [now, now, id];
    const ownerCondition = owner ? ' AND lease_owner = ?' : '';
    if (owner) params.push(owner);
    return this.db.prepare(`
      UPDATE worker_outbox
      SET status = 'COMPLETED', lease_owner = NULL, lease_until = NULL, completed_at = ?, updated_at = ?
      WHERE id = ?${ownerCondition} AND status = 'PROCESSING'
    `).run(...params).changes > 0;
  }

  fail(id: number, error: string, owner?: string): boolean {
    const params: Array<string | number> = [error.slice(0, 500), new Date().toISOString(), id];
    const ownerCondition = owner ? ' AND lease_owner = ?' : '';
    if (owner) params.push(owner);
    return this.db.prepare(`
      UPDATE worker_outbox
      SET status = 'FAILED', last_error = ?, lease_owner = NULL, lease_until = NULL, updated_at = ?
      WHERE id = ?${ownerCondition} AND status = 'PROCESSING'
    `).run(...params).changes > 0;
  }

  find(id: number): OperationalOutboxEvent | undefined {
    const row = this.db.prepare('SELECT * FROM worker_outbox WHERE id = ?').get(id) as OutboxRow | undefined;
    return row ? mapRow(row) : undefined;
  }
}

interface OutboxRow {
  id: number;
  event_key: string;
  event_type: string;
  organization_id: number | null;
  radar_id: number | null;
  payload_json: string;
  status: OutboxStatus;
  attempts: number;
  lease_owner: string | null;
  lease_until: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

function mapRow(row: OutboxRow): OperationalOutboxEvent {
  return {
    id: row.id,
    eventKey: row.event_key,
    eventType: row.event_type,
    organizationId: row.organization_id,
    radarId: row.radar_id,
    payload: parse(row.payload_json),
    status: row.status,
    attempts: row.attempts,
    leaseOwner: row.lease_owner,
    leaseUntil: row.lease_until,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  };
}

function parse(value: string): unknown {
  try { return JSON.parse(value) as unknown; } catch { return {}; }
}
