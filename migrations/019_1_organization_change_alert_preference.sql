ALTER TABLE organization_alert_preferences
  ADD COLUMN change_alerts_enabled INTEGER NOT NULL DEFAULT 1
  CHECK (change_alerts_enabled IN (0, 1));
