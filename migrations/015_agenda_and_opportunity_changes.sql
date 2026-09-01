CREATE TABLE IF NOT EXISTS opportunity_reminders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  opportunity_id INTEGER NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('BID_DEADLINE', 'DOCUMENT_REVIEW', 'FOLLOW_UP', 'MEETING')),
  title TEXT NOT NULL,
  due_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'COMPLETED', 'SKIPPED')),
  note TEXT,
  created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (organization_id, opportunity_id, type, due_at)
);

CREATE INDEX IF NOT EXISTS idx_opportunity_reminders_org_status_due
  ON opportunity_reminders(organization_id, status, due_at);

CREATE INDEX IF NOT EXISTS idx_opportunity_reminders_opportunity_due
  ON opportunity_reminders(opportunity_id, due_at);

CREATE TABLE IF NOT EXISTS opportunity_change_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  opportunity_id INTEGER NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  source_code TEXT NOT NULL,
  change_type TEXT NOT NULL CHECK (change_type IN ('DEADLINE_CHANGED', 'NOTICE_UPDATED', 'STATUS_CHANGED', 'DOCUMENT_UPDATED')),
  fingerprint TEXT NOT NULL,
  summary TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  detected_at TEXT NOT NULL,
  read_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (opportunity_id, change_type, fingerprint)
);

CREATE INDEX IF NOT EXISTS idx_opportunity_change_events_opportunity_detected
  ON opportunity_change_events(opportunity_id, detected_at DESC);
