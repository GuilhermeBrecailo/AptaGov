CREATE TABLE IF NOT EXISTS opportunity_detail_cache (
  opportunity_id INTEGER PRIMARY KEY REFERENCES opportunities(id) ON DELETE CASCADE,
  items_json TEXT NOT NULL,
  files_json TEXT NOT NULL,
  items_total INTEGER NOT NULL,
  truncated INTEGER NOT NULL,
  fetched_at TEXT NOT NULL
);
