-- Additive durable-worker hardening. The legacy checkpoint table is retained
-- as a compatibility snapshot while the new key includes flow and scope.
ALTER TABLE source_checkpoints RENAME TO source_checkpoints_legacy;

CREATE TABLE source_checkpoints (
  source_code TEXT NOT NULL CHECK (source_code IN ('PNCP', 'OPEN_DATA', 'BEC/SP')),
  flow TEXT NOT NULL DEFAULT 'opportunity' CHECK (flow IN ('opportunity', 'market')),
  scope_key TEXT NOT NULL DEFAULT 'default',
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
  PRIMARY KEY (source_code, flow, scope_key, window_start, window_end)
);

INSERT INTO source_checkpoints (
  source_code, flow, scope_key, window_start, window_end, cursor, status,
  received_count, persisted_count, created_count, updated_count, error_category,
  last_success_at, next_retry_at, created_at, updated_at
)
SELECT source_code, 'opportunity', 'default', window_start, window_end, cursor, status,
       received_count, persisted_count, created_count, updated_count, error_category,
       last_success_at, next_retry_at, created_at, updated_at
FROM source_checkpoints_legacy;

ALTER TABLE source_runs ADD COLUMN flow TEXT NOT NULL DEFAULT 'opportunity'
  CHECK (flow IN ('opportunity', 'market'));
ALTER TABLE source_runs ADD COLUMN scope_key TEXT NOT NULL DEFAULT 'default';

CREATE INDEX IF NOT EXISTS idx_source_checkpoints_scope
  ON source_checkpoints(source_code, flow, scope_key, window_start, window_end);
CREATE INDEX IF NOT EXISTS idx_source_runs_flow_scope
  ON source_runs(source_code, flow, scope_key, started_at DESC);

ALTER TABLE job_runs ADD COLUMN operational_key TEXT;
ALTER TABLE job_runs ADD COLUMN lease_owner TEXT;
ALTER TABLE job_runs ADD COLUMN lease_until TEXT;
ALTER TABLE job_runs ADD COLUMN tenant_organization_id INTEGER;
ALTER TABLE job_runs ADD COLUMN tenant_radar_id INTEGER;

UPDATE job_runs
SET operational_key = json_extract(checkpoint_json, '$.jobKey')
WHERE operational_key IS NULL
  AND json_valid(checkpoint_json)
  AND json_type(checkpoint_json, '$.jobKey') = 'text';

-- Keep the oldest active job for a key and make later legacy duplicates terminal
-- before installing the uniqueness guard.
UPDATE job_runs
SET status = 'FAILED',
    error_message = 'Duplicate active operational job absorbed during migration',
    finished_at = COALESCE(finished_at, created_at)
WHERE id IN (
  SELECT id
  FROM (
    SELECT id,
           ROW_NUMBER() OVER (PARTITION BY type, operational_key ORDER BY id) AS duplicate_rank
    FROM job_runs
    WHERE operational_key IS NOT NULL
      AND status IN ('PENDING', 'RUNNING')
  )
  WHERE duplicate_rank > 1
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_job_runs_active_operational_key
  ON job_runs(type, operational_key)
  WHERE operational_key IS NOT NULL AND status IN ('PENDING', 'RUNNING');
