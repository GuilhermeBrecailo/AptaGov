CREATE TABLE IF NOT EXISTS opportunity_feedback (
  organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  opportunity_id INTEGER NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('FAVORITED', 'NOT_RELEVANT')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (organization_id, opportunity_id)
);

CREATE INDEX IF NOT EXISTS idx_opportunity_feedback_status ON opportunity_feedback(organization_id, status, updated_at);
