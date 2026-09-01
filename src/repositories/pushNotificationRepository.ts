import type { SqliteDatabase } from '../db/database';

export interface PushSubscriptionInput {
  endpoint: string;
  expirationTime?: number | null;
  keys: {
    p256dh: string;
    auth: string;
  };
}

export interface PushSubscriptionRecord extends PushSubscriptionInput {
  id: number;
  userId: number;
  expirationTime: number | null;
  lastError: string | null;
}

export interface PushDelivery {
  id: number;
  subscriptionId: number;
  opportunityId: number;
  endpoint: string;
  p256dh: string;
  auth: string;
  expirationTime: number | null;
  title: string;
  body: string;
  url: string;
  status: 'PENDING' | 'SENT' | 'FAILED';
  attempts: number;
  lastError: string | null;
}

export interface PushQueueOptions {
  organizationId?: number;
  automaticOnly?: boolean;
}

export class PushNotificationRepository {
  constructor(private readonly db: SqliteDatabase) {}

  upsertSubscription(userId: number, input: PushSubscriptionInput): PushSubscriptionRecord {
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, expiration_time, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(endpoint) DO UPDATE SET
        user_id = excluded.user_id,
        p256dh = excluded.p256dh,
        auth = excluded.auth,
        expiration_time = excluded.expiration_time,
        updated_at = excluded.updated_at,
        last_error = NULL
    `).run(userId, input.endpoint, input.keys.p256dh, input.keys.auth, input.expirationTime ?? null, now, now);
    return this.findByEndpoint(input.endpoint) as PushSubscriptionRecord;
  }

  findByEndpoint(endpoint: string): PushSubscriptionRecord | undefined {
    const row = this.db.prepare('SELECT * FROM push_subscriptions WHERE endpoint = ?').get(endpoint) as PushSubscriptionRow | undefined;
    return row ? mapSubscription(row) : undefined;
  }

  countForUser(userId: number): number {
    return (this.db.prepare('SELECT COUNT(*) AS count FROM push_subscriptions WHERE user_id = ?').get(userId) as { count: number }).count;
  }

  removeForUser(userId: number, endpoint: string): void {
    this.db.prepare('DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?').run(userId, endpoint);
  }

  queueRecent(since: string, limit = Number.POSITIVE_INFINITY, options: PushQueueOptions = {}): number {
    const now = new Date().toISOString();
    const organizationScope = options.organizationId !== undefined
      ? 'AND m.organization_id = ?'
      : options.automaticOnly
        ? 'AND COALESCE(sync.enabled, 1) = 1'
        : '';
    const queryParams: Array<string | number> = [since];
    if (options.organizationId !== undefined) queryParams.push(options.organizationId);
    queryParams.push(now, now, normalizeLimit(limit));
    const candidates = this.db.prepare(`
      SELECT DISTINCT ps.id AS subscription_id, o.id AS opportunity_id,
        o.title, o.source_url
      FROM push_subscriptions ps
      INNER JOIN opportunities o ON o.created_at >= ?
      WHERE EXISTS (
        SELECT 1
        FROM organization_memberships m
        LEFT JOIN organization_filters f ON f.organization_id = m.organization_id
        LEFT JOIN organization_sync_settings sync ON sync.organization_id = m.organization_id
        LEFT JOIN organization_opportunity_scores os
          ON os.organization_id = m.organization_id AND os.opportunity_id = o.id
        LEFT JOIN billing_accounts b ON b.organization_id = m.organization_id
        WHERE m.user_id = ps.user_id
          ${organizationScope}
          AND COALESCE(os.score, o.score) >= COALESCE(json_extract(f.filters_json, '$.minimumScore'), 0)
          AND (
            b.organization_id IS NULL
            OR (b.status = 'ACTIVE' AND (b.current_period_ends_at IS NULL OR b.current_period_ends_at > ?))
            OR (b.status = 'TRIALING' AND b.trial_ends_at > ?)
          )
      )
      AND NOT EXISTS (
        SELECT 1 FROM push_deliveries d
        WHERE d.subscription_id = ps.id AND d.opportunity_id = o.id
      )
      ORDER BY o.created_at ASC, ps.id ASC
      LIMIT ?
    `).all(...queryParams) as PushQueueCandidate[];
    const insert = this.db.prepare(`
      INSERT INTO push_deliveries (
        subscription_id, opportunity_id, title, body, url, status, attempts, created_at, updated_at
      ) VALUES (?, ?, 'Nova oportunidade aderente', ?, ?, 'PENDING', 0, ?, ?)
      ON CONFLICT(subscription_id, opportunity_id) DO NOTHING
    `);
    return this.db.transaction(() => candidates.reduce((count, candidate) => count + insert.run(
      candidate.subscription_id,
      candidate.opportunity_id,
      `A licitação "${candidate.title.slice(0, 110)}" atingiu seu score.`,
      candidate.source_url,
      now,
      now,
    ).changes, 0))();
  }

  listPending(limit = 100): PushDelivery[] {
    const rows = this.db.prepare(`
      SELECT d.*, ps.endpoint, ps.p256dh, ps.auth, ps.expiration_time
      FROM push_deliveries d
      INNER JOIN push_subscriptions ps ON ps.id = d.subscription_id
      WHERE d.status IN ('PENDING', 'FAILED')
      ORDER BY d.created_at ASC
      LIMIT ?
    `).all(limit) as PushDeliveryRow[];
    return rows.map(mapDelivery);
  }

  pendingCount(): number {
    return (this.db.prepare("SELECT COUNT(*) AS count FROM push_deliveries WHERE status IN ('PENDING', 'FAILED')").get() as { count: number }).count;
  }

  markSent(id: number, providerId?: string): void {
    const now = new Date().toISOString();
    this.db.prepare("UPDATE push_deliveries SET status = 'SENT', provider_id = ?, sent_at = ?, updated_at = ? WHERE id = ?")
      .run(providerId ?? null, now, now, id);
  }

  markFailed(id: number, error: string): void {
    this.db.prepare("UPDATE push_deliveries SET status = 'FAILED', attempts = attempts + 1, last_error = ?, updated_at = ? WHERE id = ?")
      .run(error.slice(0, 500), new Date().toISOString(), id);
  }

  removeSubscription(subscriptionId: number): void {
    this.db.prepare('DELETE FROM push_subscriptions WHERE id = ?').run(subscriptionId);
  }
}

type PushSubscriptionRow = {
  id: number;
  user_id: number;
  endpoint: string;
  p256dh: string;
  auth: string;
  expiration_time: number | null;
  last_error: string | null;
};

type PushQueueCandidate = {
  subscription_id: number;
  opportunity_id: number;
  title: string;
  source_url: string;
};

type PushDeliveryRow = PushSubscriptionRow & {
  subscription_id: number;
  opportunity_id: number;
  title: string;
  body: string;
  url: string;
  status: PushDelivery['status'];
  attempts: number;
};

function mapSubscription(row: PushSubscriptionRow): PushSubscriptionRecord {
  return {
    id: row.id,
    userId: row.user_id,
    endpoint: row.endpoint,
    expirationTime: row.expiration_time,
    keys: { p256dh: row.p256dh, auth: row.auth },
    lastError: row.last_error,
  };
}

function mapDelivery(row: PushDeliveryRow): PushDelivery {
  return {
    id: row.id,
    subscriptionId: row.subscription_id,
    opportunityId: row.opportunity_id,
    endpoint: row.endpoint,
    p256dh: row.p256dh,
    auth: row.auth,
    expirationTime: row.expiration_time,
    title: row.title,
    body: row.body,
    url: row.url,
    status: row.status,
    attempts: row.attempts,
    lastError: row.last_error,
  };
}

function normalizeLimit(limit: number): number {
  return Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : -1;
}
