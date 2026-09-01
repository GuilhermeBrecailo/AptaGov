CREATE TABLE IF NOT EXISTS opportunity_change_event_reads (
  opportunity_change_event_id INTEGER NOT NULL REFERENCES opportunity_change_events(id) ON DELETE CASCADE,
  organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  read_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (opportunity_change_event_id, organization_id)
);

CREATE INDEX IF NOT EXISTS idx_opportunity_change_event_reads_org
  ON opportunity_change_event_reads(organization_id, read_at DESC);

INSERT OR IGNORE INTO opportunity_change_event_reads (
  opportunity_change_event_id, organization_id, read_at, created_at
)
SELECT e.id, oo.organization_id, e.read_at, e.created_at
FROM opportunity_change_events e
INNER JOIN organization_opportunities oo ON oo.opportunity_id = e.opportunity_id
WHERE e.read_at IS NOT NULL;

INSERT OR IGNORE INTO opportunity_change_event_reads (
  opportunity_change_event_id, organization_id, read_at, created_at
)
SELECT e.id, f.organization_id, e.read_at, e.created_at
FROM opportunity_change_events e
INNER JOIN opportunity_feedback f ON f.opportunity_id = e.opportunity_id
WHERE e.read_at IS NOT NULL AND f.status = 'FAVORITED';
