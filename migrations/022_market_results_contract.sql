UPDATE market_results
SET normalized_description = COALESCE(normalized_description, ''),
    unit = COALESCE(unit, ''),
    quantity = COALESCE(quantity, 0),
    organization = COALESCE(organization, ''),
    state = COALESCE(state, '');

CREATE INDEX IF NOT EXISTS idx_market_results_source_date
  ON market_results(source_code, observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_market_results_item_date
  ON market_results(item_code, observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_market_results_description_date
  ON market_results(normalized_description, observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_market_results_organization_state
  ON market_results(organization, state);
