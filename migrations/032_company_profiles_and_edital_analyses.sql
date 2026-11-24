CREATE TABLE IF NOT EXISTS company_profiles (
  organization_id INTEGER PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  profile_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS edital_analyses (
  id TEXT PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  opportunity_id INTEGER NOT NULL,
  status TEXT NOT NULL,
  profile_hash TEXT NOT NULL,
  documents_json TEXT,
  partial INTEGER NOT NULL DEFAULT 0,
  model TEXT,
  input_tokens INTEGER,
  output_tokens INTEGER,
  cost_usd_micros INTEGER,
  extraction_json TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_edital_analyses_org_opportunity
  ON edital_analyses(organization_id, opportunity_id, created_at);
