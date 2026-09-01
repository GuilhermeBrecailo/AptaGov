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

  listPending(limit = 100): NotificationDelivery[] {
    const rows = this.db.prepare(`
      SELECT d.*
      FROM notification_deliveries d
      INNER JOIN notification_settings s ON s.organization_id = d.organization_id AND s.enabled = 1
      WHERE d.status IN ('PENDING', 'FAILED')
      ORDER BY d.created_at ASC
      LIMIT ?
    `).all(limit) as NotificationDeliveryRow[];
    return rows.map(mapDelivery);
  }

  pendingCount(organizationId?: number): number {
    const row = organizationId === undefined
      ? this.db.prepare("SELECT COUNT(*) AS count FROM notification_deliveries WHERE status IN ('PENDING', 'FAILED')").get() as { count: number }
      : this.db.prepare("SELECT COUNT(*) AS count FROM notification_deliveries WHERE organization_id = ? AND status IN ('PENDING', 'FAILED')").get(organizationId) as { count: number };
    return row.count;
  }

  list(organizationId?: number): NotificationDelivery[] {
    const rows = organizationId === undefined
      ? this.db.prepare('SELECT * FROM notification_deliveries ORDER BY created_at').all() as NotificationDeliveryRow[]
      : this.db.prepare('SELECT * FROM notification_deliveries WHERE organization_id = ? ORDER BY created_at').all(organizationId) as NotificationDeliveryRow[];
    return rows.map(mapDelivery);
  }

  markSent(id: number, providerId: string | undefined): void {
    this.db.prepare("UPDATE notification_deliveries SET status = 'SENT', provider_id = ?, sent_at = ?, updated_at = ? WHERE id = ?")
      .run(providerId ?? null, new Date().toISOString(), new Date().toISOString(), id);
  }

  markFailed(id: number, error: string): void {
    this.db.prepare("UPDATE notification_deliveries SET status = 'FAILED', attempts = attempts + 1, last_error = ?, updated_at = ? WHERE id = ?")
      .run(error.slice(0, 500), new Date().toISOString(), id);
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
  };
}
