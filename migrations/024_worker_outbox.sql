CREATE TABLE IF NOT EXISTS worker_outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_key TEXT NOT NULL UNIQUE,
  event_type TEXT NOT NULL,
  organization_id INTEGER,
  radar_id INTEGER,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED')),
  attempts INTEGER NOT NULL DEFAULT 0,
  lease_owner TEXT,
  lease_until TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_worker_outbox_pending
  ON worker_outbox(status, lease_until, created_at);
CREATE INDEX IF NOT EXISTS idx_worker_outbox_organization
  ON worker_outbox(organization_id, status, created_at);
