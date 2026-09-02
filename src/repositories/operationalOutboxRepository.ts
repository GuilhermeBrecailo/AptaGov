import type { SqliteDatabase } from '../db/database';

export type OutboxStatus = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';

export const MAX_OUTBOX_ATTEMPTS = 5;
const OUTBOX_RETRY_BASE_MS = 30_000;
const OUTBOX_RETRY_MAX_MS = 60 * 60_000;

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
  nextRetryAt: string | null;
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
    if (!owner.trim()) return undefined;
    const now = new Date();
    const nowIso = now.toISOString();
    const leaseUntil = new Date(now.getTime() + Math.max(0, leaseMs)).toISOString();
    const scope = organizationId === undefined ? '' : ' AND organization_id = ?';
    const scopeParams = organizationId === undefined ? [] : [organizationId];
    const event = this.db.transaction(() => {
      this.db.prepare(`
        UPDATE worker_outbox
        SET status = 'FAILED', last_error = COALESCE(last_error, 'Limite de tentativas da outbox atingido'),
          lease_owner = NULL, lease_until = NULL, next_retry_at = NULL, updated_at = ?
        WHERE status = 'PROCESSING' AND lease_until IS NOT NULL AND lease_until <= ?
          AND attempts >= ?${scope}
      `).run(nowIso, nowIso, MAX_OUTBOX_ATTEMPTS, ...scopeParams);
      const row = this.db.prepare(`
        SELECT id FROM worker_outbox
        WHERE (
          (status IN ('PENDING', 'FAILED') AND attempts < ? AND (next_retry_at IS NULL OR next_retry_at <= ?))
          OR (status = 'PROCESSING' AND lease_until IS NOT NULL AND lease_until <= ?)
        )
          ${scope}
        ORDER BY id ASC LIMIT 1
      `).get(MAX_OUTBOX_ATTEMPTS, nowIso, nowIso, ...scopeParams) as { id: number } | undefined;
      if (!row) return undefined;
      const updated = this.db.prepare(`
        UPDATE worker_outbox
        SET status = 'PROCESSING', lease_owner = ?, lease_until = ?, attempts = attempts + 1, updated_at = ?
        WHERE id = ? AND (
          (status IN ('PENDING', 'FAILED') AND attempts < ? AND (next_retry_at IS NULL OR next_retry_at <= ?))
          OR (status = 'PROCESSING' AND lease_until IS NOT NULL AND lease_until <= ?)
        )
      `).run(owner, leaseUntil, nowIso, row.id, MAX_OUTBOX_ATTEMPTS, nowIso, nowIso, ...scopeParams);
      return updated.changes > 0 ? this.find(row.id) : undefined;
    })();
    return event;
  }

  complete(id: number, owner?: string, organizationId?: number | null): boolean {
    if (!owner?.trim() || organizationId === undefined) return false;
    const now = new Date().toISOString();
    const tenantCondition = organizationId === null ? ' AND organization_id IS NULL' : ' AND organization_id = ?';
    const params: Array<string | number | null> = [now, now, id, owner];
    if (organizationId !== null) params.push(organizationId);
    return this.db.prepare(`
      UPDATE worker_outbox
      SET status = 'COMPLETED', lease_owner = NULL, lease_until = NULL, next_retry_at = NULL, completed_at = ?, updated_at = ?
      WHERE id = ? AND lease_owner = ? AND status = 'PROCESSING'${tenantCondition}
    `).run(...params).changes > 0;
  }

  fail(id: number, error: string, owner?: string, organizationId?: number | null): boolean {
    if (!owner?.trim() || organizationId === undefined) return false;
    const now = new Date();
    const current = this.find(id);
    if (!current) return false;
    const nextRetryAt = current.attempts >= MAX_OUTBOX_ATTEMPTS
      ? null
      : new Date(now.getTime() + retryDelayMs(current.attempts)).toISOString();
    const tenantCondition = organizationId === null ? ' AND organization_id IS NULL' : ' AND organization_id = ?';
    const params: Array<string | number | null> = [error.slice(0, 500), nextRetryAt, now.toISOString(), id, owner];
    if (organizationId !== null) params.push(organizationId);
    return this.db.prepare(`
      UPDATE worker_outbox
      SET status = 'FAILED', last_error = ?, next_retry_at = ?, lease_owner = NULL, lease_until = NULL, updated_at = ?
      WHERE id = ? AND lease_owner = ? AND status = 'PROCESSING'${tenantCondition}
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
  next_retry_at: string | null;
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
    nextRetryAt: row.next_retry_at,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  };
}

function parse(value: string): unknown {
  try { return JSON.parse(value) as unknown; } catch { return {}; }
}

function retryDelayMs(attempts: number): number {
  return Math.min(OUTBOX_RETRY_MAX_MS, OUTBOX_RETRY_BASE_MS * 2 ** Math.max(0, attempts - 1));
}
