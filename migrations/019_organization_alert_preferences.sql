CREATE TABLE IF NOT EXISTS organization_alert_preferences (
  organization_id INTEGER PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  proposal_deadline_enabled INTEGER NOT NULL DEFAULT 1 CHECK (proposal_deadline_enabled IN (0, 1)),
  session_opening_enabled INTEGER NOT NULL DEFAULT 1 CHECK (session_opening_enabled IN (0, 1)),
  dispute_start_enabled INTEGER NOT NULL DEFAULT 1 CHECK (dispute_start_enabled IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
