ALTER TABLE opportunities ADD COLUMN source_code TEXT NOT NULL DEFAULT 'PNCP'
  CHECK (source_code IN ('PNCP', 'OPEN_DATA', 'BEC/SP'));

UPDATE opportunities
SET source_code = source
WHERE source IN ('PNCP', 'OPEN_DATA');

CREATE INDEX IF NOT EXISTS idx_opportunities_source_code ON opportunities(source_code);

CREATE TABLE IF NOT EXISTS market_observations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_code TEXT NOT NULL CHECK (source_code IN ('PNCP', 'OPEN_DATA', 'BEC/SP')),
  external_id TEXT NOT NULL,
  item_code TEXT NOT NULL DEFAULT '',
  normalized_description TEXT NOT NULL,
  unit TEXT NOT NULL,
  quantity REAL NOT NULL,
  unit_price_cents INTEGER,
  total_price_cents INTEGER,
  organization TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT '',
  observed_at TEXT NOT NULL,
  opportunity_id INTEGER REFERENCES opportunities(id) ON DELETE SET NULL,
  source_url TEXT NOT NULL,
  raw_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (source_code, external_id, item_code)
);

CREATE INDEX IF NOT EXISTS idx_market_observations_item_date
  ON market_observations(item_code, observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_market_observations_description_date
  ON market_observations(normalized_description, observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_market_observations_source_date
  ON market_observations(source_code, observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_market_observations_organization_state
  ON market_observations(organization, state);

CREATE TABLE IF NOT EXISTS market_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_code TEXT NOT NULL CHECK (source_code IN ('PNCP', 'OPEN_DATA', 'BEC/SP')),
  external_id TEXT NOT NULL,
  item_code TEXT NOT NULL DEFAULT '',
  normalized_description TEXT NOT NULL,
  unit TEXT NOT NULL,
  quantity REAL NOT NULL,
  unit_price_cents INTEGER,
  total_price_cents INTEGER,
  organization TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT '',
  opportunity_id INTEGER REFERENCES opportunities(id) ON DELETE SET NULL,
  winner TEXT,
  awarded_price_cents INTEGER,
  status TEXT,
  observed_at TEXT NOT NULL,
  source_url TEXT NOT NULL,
  raw_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (source_code, external_id, item_code)
);

CREATE INDEX IF NOT EXISTS idx_market_results_source_date
  ON market_results(source_code, observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_market_results_item_date
  ON market_results(item_code, observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_market_results_description_date
  ON market_results(normalized_description, observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_market_results_organization_state
  ON market_results(organization, state);
