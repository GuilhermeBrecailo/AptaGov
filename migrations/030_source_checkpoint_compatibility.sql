-- Coordinated rollout for the scoped checkpoint schema.
--
-- The new worker reads/writes source_checkpoints_scoped, whose primary key
-- includes flow and scope_key. The legacy table name remains a real table so
-- the old worker's ON CONFLICT(source_code, window_start, window_end) keeps
-- working during rollout and rollback. The application mirrors only the
-- opportunity/default namespace because the old schema cannot represent the
-- other namespaces without sharing their cursor.
ALTER TABLE source_checkpoints RENAME TO source_checkpoints_scoped;
ALTER TABLE source_checkpoints_legacy RENAME TO source_checkpoints;

CREATE INDEX IF NOT EXISTS idx_source_checkpoints_legacy_source
  ON source_checkpoints(source_code, updated_at DESC);
