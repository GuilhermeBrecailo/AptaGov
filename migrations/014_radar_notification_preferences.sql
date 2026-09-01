ALTER TABLE saved_searches ADD COLUMN notifications_enabled INTEGER NOT NULL DEFAULT 1 CHECK (notifications_enabled IN (0, 1));

CREATE INDEX IF NOT EXISTS idx_saved_searches_notifications
  ON saved_searches(organization_id, notifications_enabled, enabled);
