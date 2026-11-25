CREATE TABLE opportunity_reminders_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  opportunity_id INTEGER NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('BID_DEADLINE', 'DOCUMENT_REVIEW', 'FOLLOW_UP', 'MEETING', 'CHALLENGE_DEADLINE', 'CLARIFICATION_DEADLINE')),
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

INSERT INTO opportunity_reminders_new (
  id, organization_id, opportunity_id, type, title, due_at, status, note,
  created_by_user_id, completed_at, created_at, updated_at
)
SELECT id, organization_id, opportunity_id, type, title, due_at, status, note,
       created_by_user_id, completed_at, created_at, updated_at
FROM opportunity_reminders;

DROP TABLE opportunity_reminders;
ALTER TABLE opportunity_reminders_new RENAME TO opportunity_reminders;

CREATE INDEX IF NOT EXISTS idx_opportunity_reminders_org_status_due
  ON opportunity_reminders(organization_id, status, due_at);

CREATE INDEX IF NOT EXISTS idx_opportunity_reminders_opportunity_due
  ON opportunity_reminders(opportunity_id, due_at);

ALTER TABLE organization_alert_preferences
  ADD COLUMN challenge_deadline_enabled INTEGER NOT NULL DEFAULT 1
  CHECK (challenge_deadline_enabled IN (0, 1));

ALTER TABLE organization_alert_preferences
  ADD COLUMN clarification_deadline_enabled INTEGER NOT NULL DEFAULT 1
  CHECK (clarification_deadline_enabled IN (0, 1));
