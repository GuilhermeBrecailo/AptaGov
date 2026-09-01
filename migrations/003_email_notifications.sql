CREATE TABLE IF NOT EXISTS notification_settings (
  organization_id INTEGER PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  email TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS notification_deliveries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  opportunity_id INTEGER NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  channel TEXT NOT NULL DEFAULT 'email',
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
  UNIQUE (organization_id, opportunity_id, channel)
);

CREATE INDEX IF NOT EXISTS idx_notification_deliveries_pending
  ON notification_deliveries(status, updated_at);
