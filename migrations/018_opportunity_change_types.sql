CREATE TABLE opportunity_change_events_v2 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  opportunity_id INTEGER NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  source_code TEXT NOT NULL,
  change_type TEXT NOT NULL CHECK (change_type IN ('PROPOSAL_DEADLINE', 'SESSION_OPENING', 'DISPUTE_START', 'CLOSING_RESULT', 'SOURCE_UPDATE')),
  fingerprint TEXT NOT NULL,
  summary TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  detected_at TEXT NOT NULL,
  read_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (opportunity_id, change_type, fingerprint)
);

INSERT INTO opportunity_change_events_v2 (
  id, opportunity_id, source_code, change_type, fingerprint, summary,
  payload_json, detected_at, read_at, created_at
)
SELECT id, opportunity_id, source_code,
  CASE change_type
    WHEN 'DEADLINE_CHANGED' THEN 'PROPOSAL_DEADLINE'
    WHEN 'STATUS_CHANGED' THEN 'CLOSING_RESULT'
    ELSE 'SOURCE_UPDATE'
  END,
  change_type || ':' || fingerprint, summary, payload_json, detected_at, read_at, created_at
FROM opportunity_change_events;

CREATE TABLE opportunity_change_event_reads_v2 (
  opportunity_change_event_id INTEGER NOT NULL REFERENCES opportunity_change_events_v2(id) ON DELETE CASCADE,
  organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  read_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (opportunity_change_event_id, organization_id)
);

INSERT INTO opportunity_change_event_reads_v2 (
  opportunity_change_event_id, organization_id, read_at, created_at
)
SELECT opportunity_change_event_id, organization_id, read_at, created_at
FROM opportunity_change_event_reads;

DROP TABLE opportunity_change_event_reads;
DROP TABLE opportunity_change_events;
ALTER TABLE opportunity_change_events_v2 RENAME TO opportunity_change_events;
ALTER TABLE opportunity_change_event_reads_v2 RENAME TO opportunity_change_event_reads;

CREATE INDEX idx_opportunity_change_events_opportunity_detected
  ON opportunity_change_events(opportunity_id, detected_at DESC);
CREATE INDEX idx_opportunity_change_event_reads_org
  ON opportunity_change_event_reads(organization_id, read_at DESC);
