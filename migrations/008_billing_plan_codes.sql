ALTER TABLE billing_accounts ADD COLUMN plan_code TEXT NOT NULL DEFAULT 'STARTER'
  CHECK (plan_code IN ('STARTER', 'PRO', 'BUSINESS', 'UNLIMITED'));

UPDATE billing_accounts SET plan_code = 'STARTER' WHERE plan = 'PRO';
