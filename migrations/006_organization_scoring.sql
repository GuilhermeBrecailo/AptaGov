CREATE TABLE IF NOT EXISTS organization_opportunity_scores (
  organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  opportunity_id INTEGER NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  score INTEGER NOT NULL DEFAULT 0 CHECK (score BETWEEN 0 AND 100),
  score_breakdown_json TEXT NOT NULL DEFAULT '{}',
  classification_source TEXT NOT NULL DEFAULT 'rules',
  updated_at TEXT NOT NULL,
  PRIMARY KEY (organization_id, opportunity_id)
);

CREATE INDEX IF NOT EXISTS idx_organization_scores_score
  ON organization_opportunity_scores(organization_id, score DESC);
