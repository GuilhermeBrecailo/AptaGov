-- Additive delivery leases. Existing status and event-key constraints remain intact.
ALTER TABLE notification_deliveries ADD COLUMN lease_owner TEXT;
ALTER TABLE notification_deliveries ADD COLUMN lease_until TEXT;
ALTER TABLE push_deliveries ADD COLUMN lease_owner TEXT;
ALTER TABLE push_deliveries ADD COLUMN lease_until TEXT;

CREATE INDEX IF NOT EXISTS idx_notification_deliveries_lease
  ON notification_deliveries(status, lease_until, created_at);
CREATE INDEX IF NOT EXISTS idx_push_deliveries_lease
  ON push_deliveries(status, lease_until, created_at);
