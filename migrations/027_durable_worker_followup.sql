-- Additive follow-up for durable worker retry, tenant compatibility and single-flight.
ALTER TABLE worker_outbox ADD COLUMN next_retry_at TEXT;

CREATE INDEX IF NOT EXISTS idx_worker_outbox_retry
  ON worker_outbox(status, next_retry_at, created_at);

-- Legacy jobs carry the tenant in checkpoint_json. A null tenant remains an
-- explicit global job when the payload has no valid organization/radar IDs.
UPDATE job_runs
SET tenant_organization_id = CAST(json_extract(checkpoint_json, '$.organizationId') AS INTEGER)
WHERE tenant_organization_id IS NULL
  AND json_valid(checkpoint_json)
  AND json_type(checkpoint_json, '$.organizationId') = 'integer'
  AND CAST(json_extract(checkpoint_json, '$.organizationId') AS INTEGER) > 0;

UPDATE job_runs
SET tenant_radar_id = CAST(json_extract(checkpoint_json, '$.radarId') AS INTEGER)
WHERE tenant_radar_id IS NULL
  AND json_valid(checkpoint_json)
  AND json_type(checkpoint_json, '$.radarId') = 'integer'
  AND CAST(json_extract(checkpoint_json, '$.radarId') AS INTEGER) > 0;

-- Preserve historical rows while making the operational key single-flight
-- across all terminal states, including COMPLETED and FAILED.
UPDATE job_runs
SET operational_key = operational_key || ':legacy-duplicate:' || id
WHERE id IN (
  SELECT id
  FROM (
    SELECT id,
           ROW_NUMBER() OVER (PARTITION BY type, operational_key ORDER BY id) AS duplicate_rank
    FROM job_runs
    WHERE operational_key IS NOT NULL
  )
  WHERE duplicate_rank > 1
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_job_runs_operational_key
  ON job_runs(type, operational_key)
  WHERE operational_key IS NOT NULL;
