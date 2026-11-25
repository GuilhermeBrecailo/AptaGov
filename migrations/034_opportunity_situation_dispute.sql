ALTER TABLE opportunities ADD COLUMN situation TEXT;
ALTER TABLE opportunities ADD COLUMN dispute_mode TEXT;

UPDATE opportunities
SET situation = COALESCE(json_extract(raw_json, '$.situacaoCompraNome'), json_extract(raw_json, '$.situacaoCompraNomePncp')),
    dispute_mode = COALESCE(json_extract(raw_json, '$.modoDisputaNome'), json_extract(raw_json, '$.modoDisputaNomePncp'))
WHERE json_valid(raw_json);

CREATE INDEX IF NOT EXISTS idx_opportunities_situation ON opportunities(situation);
CREATE INDEX IF NOT EXISTS idx_opportunities_state_city ON opportunities(state, city);
CREATE INDEX IF NOT EXISTS idx_opportunities_modality ON opportunities(modality);
