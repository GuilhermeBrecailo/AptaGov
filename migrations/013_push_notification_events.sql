ALTER TABLE push_deliveries RENAME TO push_deliveries_legacy;

CREATE TABLE push_deliveries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subscription_id INTEGER NOT NULL REFERENCES push_subscriptions(id) ON DELETE CASCADE,
  opportunity_id INTEGER NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL DEFAULT 'NEW_OPPORTUNITY',
  event_key TEXT NOT NULL DEFAULT 'new_opportunity',
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'SENT', 'FAILED')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  provider_id TEXT,
  created_at TEXT NOT NULL,
  sent_at TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE (subscription_id, opportunity_id, event_key)
);

INSERT INTO push_deliveries (
  id, subscription_id, opportunity_id, event_type, event_key, title, body, url, status, attempts,
  last_error, provider_id, created_at, sent_at, updated_at
)
SELECT id, subscription_id, opportunity_id, 'NEW_OPPORTUNITY', 'new_opportunity', title, body, url, status, attempts,
  last_error, provider_id, created_at, sent_at, updated_at
FROM push_deliveries_legacy;

DROP TABLE push_deliveries_legacy;

CREATE INDEX IF NOT EXISTS idx_push_deliveries_pending
  ON push_deliveries(status, updated_at);
