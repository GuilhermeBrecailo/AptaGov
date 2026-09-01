CREATE TABLE IF NOT EXISTS billing_accounts (
  organization_id INTEGER PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  plan TEXT NOT NULL DEFAULT 'TRIAL' CHECK (plan IN ('TRIAL', 'PRO')),
  status TEXT NOT NULL DEFAULT 'TRIALING' CHECK (status IN ('TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELED', 'INACTIVE')),
  trial_ends_at TEXT NOT NULL,
  current_period_ends_at TEXT,
  provider TEXT,
  provider_customer_id TEXT,
  provider_subscription_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_provider_subscription
  ON billing_accounts(provider, provider_subscription_id)
  WHERE provider_subscription_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS billing_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL,
  provider_event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  organization_id INTEGER REFERENCES organizations(id) ON DELETE SET NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  UNIQUE (provider, provider_event_id)
);
