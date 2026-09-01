CREATE TABLE IF NOT EXISTS organization_sync_settings (
  organization_id INTEGER PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  updated_at TEXT NOT NULL
);
