import type { SqliteDatabase } from '../db/database';

export type JobStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';

export interface JobTenant {
  organizationId?: number | null;
  radarId?: number | null;
}

export interface JobRecord {
  id: number;
  type: string;
  status: JobStatus;
  checkpoint: Record<string, unknown>;
  errorMessage: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  operationalKey: string | null;
  key: string | null;
  leaseOwner: string | null;
  leaseUntil: string | null;
  tenantOrganizationId: number | null;
  tenantRadarId: number | null;
}

interface JobRow {
  id: number;
  type: string;
  status: JobStatus;
  checkpoint_json: string;
  error_message: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  operational_key: string | null;
  lease_owner: string | null;
  lease_until: string | null;
  tenant_organization_id: number | null;
  tenant_radar_id: number | null;
}

export interface ReservedJob {
  id: number;
  created: boolean;
}

export const DEFAULT_JOB_LEASE_MS = 5 * 60_000;

export class JobRepository {
  constructor(private readonly db: SqliteDatabase) {}

  create(type: string, checkpoint: Record<string, unknown> = {}, key?: string, tenant?: JobTenant): number {
    return this.reserve(type, checkpoint, key, tenant).id;
  }

  reserve(type: string, checkpoint: Record<string, unknown> = {}, key?: string, tenant?: JobTenant): ReservedJob {
    const operationalKey = normalizeKey(key ?? readString(checkpoint.jobKey));
    const payload = operationalKey && checkpoint.jobKey === undefined
      ? { ...checkpoint, jobKey: operationalKey }
      : checkpoint;
    const scope = tenantFrom(checkpoint, tenant);
    const now = new Date().toISOString();
    const result = this.db.prepare(`
      INSERT INTO job_runs (
        type, checkpoint_json, operational_key, tenant_organization_id, tenant_radar_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT DO NOTHING
    `).run(
      type,
      JSON.stringify(payload),
      operationalKey,
      scope.organizationId ?? null,
      scope.radarId ?? null,
      now,
    );
    if (result.changes > 0) return { id: Number(result.lastInsertRowid), created: true };
    if (!operationalKey) throw new Error('Não foi possível reservar o job');
    const existing = this.db.prepare(`
      SELECT id FROM job_runs
      WHERE type = ? AND operational_key = ? AND status IN ('PENDING', 'RUNNING')
      ORDER BY id ASC LIMIT 1
    `).get(type, operationalKey) as { id: number } | undefined;
    if (!existing) throw new Error('Job operacional não encontrado após conflito de reserva');
    return { id: existing.id, created: false };
  }

  markRunning(id: number, owner = 'legacy-runtime', leaseMs = DEFAULT_JOB_LEASE_MS): boolean {
    return this.claim(id, owner, leaseMs);
  }

  claim(id: number, owner = 'default-runtime', leaseMs = DEFAULT_JOB_LEASE_MS, tenant?: JobTenant): boolean {
    const now = new Date();
    const nowIso = now.toISOString();
    const leaseUntil = new Date(now.getTime() + Math.max(0, leaseMs)).toISOString();
    const conditions = [
      'id = ?',
      "((status = 'PENDING') OR (status = 'RUNNING' AND lease_until IS NOT NULL AND lease_until <= ?))",
    ];
    const params: Array<string | number | null> = [id, nowIso];
    if (tenant?.organizationId !== undefined) {
      conditions.push('tenant_organization_id = ?');
      params.push(tenant.organizationId);
    }
    if (tenant?.radarId !== undefined) {
      if (tenant.radarId === null) conditions.push('tenant_radar_id IS NULL');
      else {
        conditions.push('tenant_radar_id = ?');
        params.push(tenant.radarId);
      }
    }
    const result = this.db.prepare(`
      UPDATE job_runs
      SET status = 'RUNNING', started_at = COALESCE(started_at, ?),
        lease_owner = ?, lease_until = ?, error_message = NULL
      WHERE ${conditions.join(' AND ')}
    `).run(nowIso, owner, leaseUntil, ...params);
    return result.changes > 0;
  }

  renew(id: number, owner: string, leaseMs = DEFAULT_JOB_LEASE_MS): boolean {
    const leaseUntil = new Date(Date.now() + Math.max(0, leaseMs)).toISOString();
    return this.db.prepare(`
      UPDATE job_runs SET lease_until = ?
      WHERE id = ? AND status = 'RUNNING' AND lease_owner = ?
    `).run(leaseUntil, id, owner).changes > 0;
  }

  markCompleted(id: number, owner?: string): boolean {
    const params: Array<string | number> = [new Date().toISOString(), id];
    const ownerCondition = owner ? ' AND lease_owner = ?' : '';
    if (owner) params.push(owner);
    return this.db.prepare(`
      UPDATE job_runs
      SET status = 'COMPLETED', finished_at = ?, lease_owner = NULL, lease_until = NULL
      WHERE id = ?${ownerCondition} AND (status = 'RUNNING' OR (status = 'PENDING' AND type = 'sync_and_classify'))
    `).run(...params).changes > 0;
  }

  markFailed(id: number, error: string, owner?: string): boolean {
    const params: Array<string | number> = [error.slice(0, 500), new Date().toISOString(), id];
    const ownerCondition = owner ? ' AND lease_owner = ?' : '';
    if (owner) params.push(owner);
    return this.db.prepare(`
      UPDATE job_runs
      SET status = 'FAILED', error_message = ?, finished_at = ?, lease_owner = NULL, lease_until = NULL
      WHERE id = ?${ownerCondition} AND status = 'RUNNING'
    `).run(...params).changes > 0;
  }

  updateCheckpoint(id: number, checkpoint: Record<string, unknown>, owner?: string): boolean {
    const current = this.find(id);
    if (!current) return false;
    const params: Array<string | number> = [JSON.stringify({ ...current.checkpoint, ...checkpoint }), id];
    const ownerCondition = owner ? ' AND lease_owner = ?' : '';
    if (owner) params.push(owner);
    return this.db.prepare(`UPDATE job_runs SET checkpoint_json = ? WHERE id = ?${ownerCondition}`).run(...params).changes > 0;
  }

  recoverInterrupted(now = new Date(), staleAfterMs = DEFAULT_JOB_LEASE_MS): JobRecord[] {
    const nowIso = now.toISOString();
    const cutoff = new Date(now.getTime() - Math.max(0, staleAfterMs)).toISOString();
    return this.db.transaction(() => {
      const rows = this.db.prepare(`
        SELECT * FROM job_runs
        WHERE status = 'RUNNING'
          AND (
            (lease_until IS NOT NULL AND lease_until <= ?)
            OR (lease_until IS NULL AND COALESCE(started_at, created_at) <= ?)
          )
        ORDER BY id ASC
      `).all(nowIso, cutoff) as JobRow[];
      for (const row of rows) {
        this.db.prepare(`
          UPDATE job_runs
          SET status = 'PENDING', started_at = NULL, lease_owner = NULL, lease_until = NULL
          WHERE id = ? AND status = 'RUNNING'
        `).run(row.id);
      }
      return rows.map((row) => mapRow({ ...row, status: 'PENDING', started_at: null, lease_owner: null, lease_until: null }));
    })();
  }

  list(status?: JobStatus, tenant?: JobTenant): JobRecord[] {
    const conditions: string[] = [];
    const params: Array<string | number | null> = [];
    if (status) {
      conditions.push('status = ?');
      params.push(status);
    }
    if (tenant?.organizationId !== undefined) {
      conditions.push('tenant_organization_id = ?');
      params.push(tenant.organizationId);
    }
    if (tenant?.radarId !== undefined) {
      if (tenant.radarId === null) conditions.push('tenant_radar_id IS NULL');
      else {
        conditions.push('tenant_radar_id = ?');
        params.push(tenant.radarId);
      }
    }
    const where = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '';
    const rows = this.db.prepare(`SELECT * FROM job_runs${where} ORDER BY id ASC`).all(...params) as JobRow[];
    return rows.map(mapRow);
  }

  find(id: number): JobRecord | undefined {
    const row = this.db.prepare('SELECT * FROM job_runs WHERE id = ?').get(id) as JobRow | undefined;
    return row ? mapRow(row) : undefined;
  }
}

function tenantFrom(checkpoint: Record<string, unknown>, tenant?: JobTenant): JobTenant {
  return {
    organizationId: tenant?.organizationId !== undefined ? tenant.organizationId : readNumber(checkpoint.organizationId),
    radarId: tenant?.radarId !== undefined ? tenant.radarId : readNumber(checkpoint.radarId),
  };
}

function mapRow(row: JobRow): JobRecord {
  const checkpoint = parseCheckpoint(row.checkpoint_json);
  const operationalKey = row.operational_key ?? readString(checkpoint.jobKey);
  return {
    id: row.id,
    type: row.type,
    status: row.status,
    checkpoint,
    errorMessage: row.error_message,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    createdAt: row.created_at,
    operationalKey: operationalKey ?? null,
    key: operationalKey ?? null,
    leaseOwner: row.lease_owner,
    leaseUntil: row.lease_until,
    tenantOrganizationId: row.tenant_organization_id,
    tenantRadarId: row.tenant_radar_id,
  };
}

function parseCheckpoint(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function normalizeKey(value: string | undefined): string | null {
  const key = value?.trim();
  return key ? key : null;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function readNumber(value: unknown): number | null | undefined {
  return typeof value === 'number' && Number.isInteger(value) ? value : undefined;
}
