CREATE TABLE IF NOT EXISTS source_checkpoints (
  source_code TEXT NOT NULL CHECK (source_code IN ('PNCP', 'OPEN_DATA', 'BEC/SP')),
  window_start TEXT NOT NULL,
  window_end TEXT NOT NULL,
  cursor TEXT,
  status TEXT NOT NULL CHECK (status IN ('RUNNING', 'COMPLETED', 'FAILED')),
  received_count INTEGER NOT NULL DEFAULT 0,
  persisted_count INTEGER NOT NULL DEFAULT 0,
  created_count INTEGER NOT NULL DEFAULT 0,
  updated_count INTEGER NOT NULL DEFAULT 0,
  error_category TEXT,
  last_success_at TEXT,
  next_retry_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (source_code, window_start, window_end)
);

CREATE TABLE IF NOT EXISTS source_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_code TEXT NOT NULL CHECK (source_code IN ('PNCP', 'OPEN_DATA', 'BEC/SP')),
  window_start TEXT NOT NULL,
  window_end TEXT NOT NULL,
  cursor TEXT,
  status TEXT NOT NULL CHECK (status IN ('RUNNING', 'COMPLETED', 'FAILED')),
  received_count INTEGER NOT NULL DEFAULT 0,
  persisted_count INTEGER NOT NULL DEFAULT 0,
  created_count INTEGER NOT NULL DEFAULT 0,
  updated_count INTEGER NOT NULL DEFAULT 0,
  error_category TEXT,
  error_message TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_source_runs_source_started
  ON source_runs(source_code, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_source_runs_status
  ON source_runs(status, started_at DESC);
