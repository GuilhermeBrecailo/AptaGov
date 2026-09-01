CREATE TABLE IF NOT EXISTS opportunity_checklist_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  opportunity_id INTEGER NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('DOCUMENTS', 'COMMERCIAL', 'PROPOSAL', 'SESSION', 'REVIEW')),
  status TEXT NOT NULL CHECK (status IN ('OPEN', 'COMPLETED', 'SKIPPED')) DEFAULT 'OPEN',
  assignee_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  due_at TEXT,
  note TEXT,
  position INTEGER NOT NULL,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (organization_id, opportunity_id, title)
);

CREATE INDEX IF NOT EXISTS idx_opportunity_checklist_items_org_opportunity_position
  ON opportunity_checklist_items(organization_id, opportunity_id, position, id);

CREATE INDEX IF NOT EXISTS idx_opportunity_checklist_items_org_status
  ON opportunity_checklist_items(organization_id, status, due_at);
