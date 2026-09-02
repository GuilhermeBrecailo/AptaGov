CREATE TABLE IF NOT EXISTS worker_pauses (
  stage TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT '',
  channel TEXT NOT NULL DEFAULT '',
  reason TEXT NOT NULL,
  details_json TEXT NOT NULL DEFAULT '{}',
  paused_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (stage, source, channel)
);

CREATE INDEX IF NOT EXISTS idx_worker_pauses_stage
  ON worker_pauses(stage, source, channel);
