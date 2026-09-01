ALTER TABLE opportunities ADD COLUMN source TEXT NOT NULL DEFAULT 'PNCP' CHECK (source IN ('PNCP', 'OPEN_DATA'));

CREATE INDEX IF NOT EXISTS idx_opportunities_source ON opportunities(source);
