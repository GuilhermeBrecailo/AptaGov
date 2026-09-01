CREATE TABLE IF NOT EXISTS opportunities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pncp_id TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  organization TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  modality TEXT NOT NULL DEFAULT '',
  source_url TEXT NOT NULL,
  publication_date TEXT NOT NULL,
  bidding_deadline TEXT,
  estimated_value_cents INTEGER NOT NULL DEFAULT 0,
  kanban_state TEXT NOT NULL DEFAULT 'NEW',
  score INTEGER NOT NULL DEFAULT 0,
  score_breakdown_json TEXT NOT NULL DEFAULT '{}',
  classification_source TEXT NOT NULL DEFAULT 'rules',
  raw_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_opportunities_kanban_state ON opportunities(kanban_state);
CREATE INDEX IF NOT EXISTS idx_opportunities_score ON opportunities(score DESC);
CREATE INDEX IF NOT EXISTS idx_opportunities_publication_date ON opportunities(publication_date DESC);

CREATE TABLE IF NOT EXISTS opportunity_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  opportunity_id INTEGER NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  from_state TEXT,
  to_state TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS job_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  checkpoint_json TEXT NOT NULL DEFAULT '{}',
  error_message TEXT,
  started_at TEXT,
  finished_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_job_runs_status ON job_runs(status, created_at);

CREATE TABLE IF NOT EXISTS system_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
);
