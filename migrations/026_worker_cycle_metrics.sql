CREATE TABLE IF NOT EXISTS worker_cycle_metrics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mode TEXT NOT NULL CHECK (mode IN ('automatic', 'manual')),
  started_at TEXT NOT NULL,
  finished_at TEXT NOT NULL,
  paused INTEGER NOT NULL DEFAULT 0,
  metrics_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_worker_cycle_metrics_finished
  ON worker_cycle_metrics(finished_at DESC, id DESC);
