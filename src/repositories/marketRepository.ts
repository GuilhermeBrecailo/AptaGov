import type { SqliteDatabase } from '../db/database';
import type { SourceId } from '../domain/sourceTypes';

export interface MarketRepositoryQuery {
  dateFrom?: string;
  dateTo?: string;
  state?: string;
  organization?: string;
  normalizedDescription?: string;
  itemCode?: string;
  unit?: string;
}

export type MarketRecordType = 'OBSERVATION' | 'RESULT';

export interface MarketRecord {
  id: number;
  recordType: MarketRecordType;
  sourceCode: SourceId;
  externalId: string;
  itemCode: string;
  normalizedDescription: string;
  unit: string;
  quantity: number;
  unitPriceCents: number | null;
  totalPriceCents: number | null;
  organization: string;
  state: string;
  modality: string;
  status: string | null;
  observedAt: string;
  sourceUrl: string;
  opportunityId: number | null;
}

interface MarketRecordRow {
  id: number;
  record_type: MarketRecordType;
  source_code: SourceId;
  external_id: string;
  item_code: string;
  normalized_description: string;
  unit: string;
  quantity: number;
  unit_price_cents: number | null;
  total_price_cents: number | null;
  organization: string;
  state: string;
  modality: string;
  status: string | null;
  observed_at: string;
  source_url: string;
  opportunity_id: number | null;
}

export class MarketRepository {
  constructor(private readonly db: SqliteDatabase) {}

  list(query: MarketRepositoryQuery = {}): MarketRecord[] {
    const conditions: string[] = [];
    const params: Array<string | number> = [];
    addFilters(conditions, params, query);
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const rows = this.db.prepare(`
      SELECT market.*
      FROM (
        SELECT
          mo.id,
          'OBSERVATION' AS record_type,
          mo.source_code,
          mo.external_id,
          mo.item_code,
          mo.normalized_description,
          mo.unit,
          mo.quantity,
          mo.unit_price_cents,
          mo.total_price_cents,
          mo.organization,
          mo.state,
          COALESCE(o.modality, '') AS modality,
          NULL AS status,
          mo.observed_at,
          mo.source_url,
          mo.opportunity_id
        FROM market_observations mo
        LEFT JOIN opportunities o ON o.id = mo.opportunity_id

        UNION ALL

        SELECT
          mr.id,
          'RESULT' AS record_type,
          mr.source_code,
          mr.external_id,
          mr.item_code,
          mr.normalized_description,
          mr.unit,
          mr.quantity,
          mr.unit_price_cents,
          mr.total_price_cents,
          mr.organization,
          mr.state,
          COALESCE(o.modality, '') AS modality,
          mr.status,
          mr.observed_at,
          mr.source_url,
          mr.opportunity_id
        FROM market_results mr
        LEFT JOIN opportunities o ON o.id = mr.opportunity_id
      ) market
      ${where}
      ORDER BY market.observed_at DESC, market.id DESC
    `).all(...params) as MarketRecordRow[];

    return rows.map((row) => ({
      id: row.id,
      recordType: row.record_type,
      sourceCode: row.source_code,
      externalId: row.external_id,
      itemCode: row.item_code,
      normalizedDescription: row.normalized_description,
      unit: row.unit,
      quantity: row.quantity,
      unitPriceCents: row.unit_price_cents,
      totalPriceCents: row.total_price_cents,
      organization: row.organization,
      state: row.state,
      modality: row.modality,
      status: row.status,
      observedAt: row.observed_at,
      sourceUrl: row.source_url,
      opportunityId: row.opportunity_id,
    }));
  }

  listMarketRecords(query: MarketRepositoryQuery = {}): MarketRecord[] {
    return this.list(query);
  }
}

function addFilters(conditions: string[], params: Array<string | number>, query: MarketRepositoryQuery): void {
  if (query.dateFrom) {
    conditions.push('market.observed_at >= ?');
    params.push(query.dateFrom);
  }
  if (query.dateTo) {
    conditions.push('market.observed_at <= ?');
    params.push(query.dateTo);
  }
  if (query.state?.trim()) {
    conditions.push('UPPER(market.state) = ?');
    params.push(query.state.trim().toUpperCase());
  }
  if (query.organization?.trim()) {
    conditions.push('LOWER(market.organization) = LOWER(?)');
    params.push(query.organization.trim());
  }
  if (query.normalizedDescription?.trim()) {
    conditions.push('market.normalized_description = ?');
    params.push(normalizeDescription(query.normalizedDescription));
  }
  if (query.itemCode?.trim()) {
    conditions.push('UPPER(market.item_code) = ?');
    params.push(query.itemCode.trim().toUpperCase());
  }
  if (query.unit?.trim()) {
    conditions.push('UPPER(market.unit) = ?');
    params.push(query.unit.trim().toUpperCase());
  }
}

export function normalizeDescription(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}
