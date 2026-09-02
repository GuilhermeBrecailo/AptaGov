import type { SqliteDatabase } from '../db/database';

export type NotificationDeliveryStatus = 'PENDING' | 'SENT' | 'FAILED';

export interface NotificationSettings {
  organizationId: number;
  enabled: boolean;
  email: string;
}

export interface NotificationDelivery {
  id: number;
  organizationId: number;
  opportunityId: number;
  channel: 'email';
  eventType: string;
  eventKey: string;
  recipient: string;
  subject: string;
  body: string;
  status: NotificationDeliveryStatus;
  attempts: number;
  lastError: string | null;
  providerId: string | null;
  leaseOwner: string | null;
  leaseUntil: string | null;
}

export interface NotificationInput {
  organizationId: number;
  opportunityId: number;
  recipient: string;
  subject: string;
  body: string;
  eventType?: string;
  eventKey?: string;
}

export interface OperationalNotificationInput extends NotificationInput {
  eventType: string;
  eventKey: string;
}

export const DEFAULT_NOTIFICATION_LEASE_MS = 5 * 60_000;

export class NotificationRepository {
  constructor(private readonly db: SqliteDatabase) {}

  findSettings(organizationId: number): NotificationSettings | undefined {
    const row = this.db.prepare('SELECT organization_id, enabled, email FROM notification_settings WHERE organization_id = ?')
      .get(organizationId) as NotificationSettingsRow | undefined;
    return row ? mapSettings(row) : undefined;
  }

  saveSettings(organizationId: number, settings: Omit<NotificationSettings, 'organizationId'>): NotificationSettings {
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO notification_settings (organization_id, enabled, email, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(organization_id) DO UPDATE SET enabled = excluded.enabled, email = excluded.email, updated_at = excluded.updated_at
    `).run(organizationId, settings.enabled ? 1 : 0, settings.email.trim().toLowerCase(), now, now);
    return this.findSettings(organizationId) as NotificationSettings;
  }

  listEnabledSettings(): NotificationSettings[] {
    const rows = this.db.prepare('SELECT organization_id, enabled, email FROM notification_settings WHERE enabled = 1').all() as NotificationSettingsRow[];
    return rows.map(mapSettings);
  }

  enqueue(input: NotificationInput): boolean {
    const now = new Date().toISOString();
    const result = this.db.prepare(`
      INSERT INTO notification_deliveries (
        organization_id, opportunity_id, channel, event_type, event_key, recipient, subject, body, status, attempts, created_at, updated_at
      ) VALUES (?, ?, 'email', ?, ?, ?, ?, ?, 'PENDING', 0, ?, ?)
      ON CONFLICT(organization_id, opportunity_id, channel, event_key) DO NOTHING
    `).run(input.organizationId, input.opportunityId, input.eventType ?? 'NEW_OPPORTUNITY', input.eventKey ?? 'new_opportunity', input.recipient, input.subject, input.body, now, now);
    return result.changes > 0;
  }

  enqueueOperational(input: OperationalNotificationInput): boolean {
    return this.enqueue(input);
  }

  listPending(limit = 100, organizationId?: number): NotificationDelivery[] {
    const scope = organizationId === undefined ? '' : ' AND d.organization_id = ?';
    const params = organizationId === undefined ? [limit] : [organizationId, limit];
    const rows = this.db.prepare(`
      SELECT d.*
      FROM notification_deliveries d
      INNER JOIN notification_settings s ON s.organization_id = d.organization_id AND s.enabled = 1
      WHERE d.status IN ('PENDING', 'FAILED')
        ${scope}
      ORDER BY d.created_at ASC
      LIMIT ?
    `).all(...params) as NotificationDeliveryRow[];
    return rows.map(mapDelivery);
  }

  pendingCount(organizationId?: number): number {
    const row = organizationId === undefined
      ? this.db.prepare("SELECT COUNT(*) AS count FROM notification_deliveries WHERE status IN ('PENDING', 'FAILED')").get() as { count: number }
      : this.db.prepare("SELECT COUNT(*) AS count FROM notification_deliveries WHERE organization_id = ? AND status IN ('PENDING', 'FAILED')").get(organizationId) as { count: number };
    return row.count;
  }

  hasRecentSuccess(since: string): boolean {
    return Boolean(this.db.prepare("SELECT 1 FROM notification_deliveries WHERE status = 'SENT' AND sent_at >= ? LIMIT 1").get(since));
  }

  claimNext(owner: string, leaseMs = DEFAULT_NOTIFICATION_LEASE_MS, organizationId?: number): NotificationDelivery | undefined {
    if (!owner.trim()) return undefined;
    const now = new Date();
    const nowIso = now.toISOString();
    const leaseUntil = new Date(now.getTime() + Math.max(0, leaseMs)).toISOString();
    const scope = organizationId === undefined ? '' : ' AND d.organization_id = ?';
    const updateScope = organizationId === undefined ? '' : ' AND organization_id = ?';
    const scopeParams = organizationId === undefined ? [] : [organizationId];
    return this.db.transaction(() => {
      const row = this.db.prepare(`
        SELECT d.id
        FROM notification_deliveries d
        INNER JOIN notification_settings s ON s.organization_id = d.organization_id AND s.enabled = 1
        WHERE (
          d.status IN ('PENDING', 'FAILED')
          OR (d.status = 'PROCESSING' AND d.lease_until IS NOT NULL AND d.lease_until <= ?)
        )${scope}
        ORDER BY d.created_at ASC, d.id ASC
        LIMIT 1
      `).get(nowIso, ...scopeParams) as { id: number } | undefined;
      if (!row) return undefined;
      const updated = this.db.prepare(`
        UPDATE notification_deliveries
        SET status = 'PROCESSING', lease_owner = ?, lease_until = ?, updated_at = ?
        WHERE id = ?
          AND (
            status IN ('PENDING', 'FAILED')
            OR (status = 'PROCESSING' AND lease_until IS NOT NULL AND lease_until <= ?)
          )${updateScope}
      `).run(owner, leaseUntil, nowIso, row.id, nowIso, ...scopeParams);
      return updated.changes > 0 ? this.find(row.id) : undefined;
    })();
  }

  renew(id: number, owner: string, leaseMs = DEFAULT_NOTIFICATION_LEASE_MS): boolean {
    const leaseUntil = new Date(Date.now() + Math.max(0, leaseMs)).toISOString();
    return this.db.prepare(`
      UPDATE notification_deliveries
      SET lease_until = ?, updated_at = ?
      WHERE id = ? AND status = 'PROCESSING' AND lease_owner = ?
    `).run(leaseUntil, new Date().toISOString(), id, owner).changes > 0;
  }

  list(organizationId?: number): NotificationDelivery[] {
    const rows = organizationId === undefined
      ? this.db.prepare('SELECT * FROM notification_deliveries ORDER BY created_at').all() as NotificationDeliveryRow[]
      : this.db.prepare('SELECT * FROM notification_deliveries WHERE organization_id = ? ORDER BY created_at').all(organizationId) as NotificationDeliveryRow[];
    return rows.map(mapDelivery);
  }

  markSent(id: number, providerId: string | undefined, owner?: string): boolean {
    if (!owner?.trim()) return false;
    const now = new Date().toISOString();
    return this.db.prepare("UPDATE notification_deliveries SET status = 'SENT', provider_id = ?, sent_at = ?, lease_owner = NULL, lease_until = NULL, updated_at = ? WHERE id = ? AND status = 'PROCESSING' AND lease_owner = ?")
      .run(providerId ?? null, now, now, id, owner).changes > 0;
  }

  markFailed(id: number, error: string, owner?: string): boolean {
    if (!owner?.trim()) return false;
    return this.db.prepare("UPDATE notification_deliveries SET status = 'FAILED', attempts = attempts + 1, last_error = ?, lease_owner = NULL, lease_until = NULL, updated_at = ? WHERE id = ? AND status = 'PROCESSING' AND lease_owner = ?")
      .run(error.slice(0, 500), new Date().toISOString(), id, owner).changes > 0;
  }

  private find(id: number): NotificationDelivery | undefined {
    const row = this.db.prepare('SELECT * FROM notification_deliveries WHERE id = ?').get(id) as NotificationDeliveryRow | undefined;
    return row ? mapDelivery(row) : undefined;
  }
}

type NotificationSettingsRow = { organization_id: number; enabled: number; email: string };
type NotificationDeliveryRow = {
  id: number;
  organization_id: number;
  opportunity_id: number;
  channel: 'email';
  event_type: string;
  event_key: string;
  recipient: string;
  subject: string;
  body: string;
  status: NotificationDeliveryStatus;
  attempts: number;
  last_error: string | null;
  provider_id: string | null;
  lease_owner: string | null;
  lease_until: string | null;
};

function mapSettings(row: NotificationSettingsRow): NotificationSettings {
  return { organizationId: row.organization_id, enabled: row.enabled === 1, email: row.email };
}

function mapDelivery(row: NotificationDeliveryRow): NotificationDelivery {
  return {
    id: row.id,
    organizationId: row.organization_id,
    opportunityId: row.opportunity_id,
    channel: row.channel,
    eventType: row.event_type,
    eventKey: row.event_key,
    recipient: row.recipient,
    subject: row.subject,
    body: row.body,
    status: row.status,
    attempts: row.attempts,
    lastError: row.last_error,
    providerId: row.provider_id,
    leaseOwner: row.lease_owner,
    leaseUntil: row.lease_until,
  };
}
