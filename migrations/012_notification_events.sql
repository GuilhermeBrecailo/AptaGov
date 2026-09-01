ALTER TABLE notification_deliveries RENAME TO notification_deliveries_legacy;

CREATE TABLE notification_deliveries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  opportunity_id INTEGER NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  channel TEXT NOT NULL DEFAULT 'email',
  event_type TEXT NOT NULL DEFAULT 'NEW_OPPORTUNITY',
  event_key TEXT NOT NULL DEFAULT 'new_opportunity',
  recipient TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  provider_id TEXT,
  created_at TEXT NOT NULL,
  sent_at TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE (organization_id, opportunity_id, channel, event_key)
);

INSERT INTO notification_deliveries (
  id, organization_id, opportunity_id, channel, event_type, event_key, recipient, subject, body,
  status, attempts, last_error, provider_id, created_at, sent_at, updated_at
)
SELECT id, organization_id, opportunity_id, channel, 'NEW_OPPORTUNITY', 'new_opportunity', recipient, subject, body,
  status, attempts, last_error, provider_id, created_at, sent_at, updated_at
FROM notification_deliveries_legacy;

DROP TABLE notification_deliveries_legacy;

CREATE INDEX IF NOT EXISTS idx_notification_deliveries_pending
  ON notification_deliveries(status, updated_at);
