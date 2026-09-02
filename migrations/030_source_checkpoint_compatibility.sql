-- Keep source_checkpoints as the scoped canonical table created by migration
-- 023. Worker 0aca7bf reads/writes this exact table and uses its five-column
-- ON CONFLICT key. Renaming it would make rollback incompatible; the old
-- three-column snapshot remains explicitly named source_checkpoints_legacy.
--
-- Databases that already applied the earlier, unsafe 030 are repaired by the
-- additive 031 migration. No flow is mirrored into the legacy snapshot except
-- opportunity/default, because that schema cannot represent market scopes.
CREATE INDEX IF NOT EXISTS idx_source_checkpoints_scoped_rollout
  ON source_checkpoints(source_code, flow, scope_key, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_source_checkpoints_legacy_source
  ON source_checkpoints_legacy(source_code, updated_at DESC);
