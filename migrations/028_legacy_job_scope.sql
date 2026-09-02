-- Make old global jobs explicit and terminalize incompatible tenant payloads
-- instead of leaving them as unclaimable pending orphans.
UPDATE job_runs
SET checkpoint_json = json_set(checkpoint_json, '$.tenantScope', 'global')
WHERE tenant_organization_id IS NULL
  AND tenant_radar_id IS NULL
  AND json_valid(checkpoint_json)
  AND json_type(checkpoint_json, '$.organizationId') IS NULL
  AND json_type(checkpoint_json, '$.radarId') IS NULL
  AND json_type(checkpoint_json, '$.tenantScope') IS NULL;

UPDATE job_runs
SET status = 'FAILED',
    error_message = 'Legacy job has incompatible tenant payload',
    finished_at = COALESCE(finished_at, created_at),
    lease_owner = NULL,
    lease_until = NULL
WHERE status IN ('PENDING', 'RUNNING')
  AND json_valid(checkpoint_json)
  AND (
    (json_type(checkpoint_json, '$.organizationId') IS NOT NULL
      AND json_type(checkpoint_json, '$.organizationId') <> 'integer')
    OR (json_type(checkpoint_json, '$.radarId') IS NOT NULL
      AND json_type(checkpoint_json, '$.radarId') <> 'integer')
  );
