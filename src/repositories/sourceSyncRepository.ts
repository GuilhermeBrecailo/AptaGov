import type { SqliteDatabase } from '../db/database';
import type {
  MarketObservationInput,
  SourceId,
  SourceWindow,
} from '../domain/sourceTypes';
import type { OpportunityInput } from '../domain/types';
import { OpportunityRepository } from './opportunityRepository';

export type SourceCheckpointStatus = 'RUNNING' | 'COMPLETED' | 'FAILED';

export interface SourceCheckpoint {
  sourceCode: SourceId;
  window: SourceWindow;
  cursor: string | null;
  status: SourceCheckpointStatus;
  receivedCount: number;
  persistedCount: number;
  createdCount: number;
  updatedCount: number;
  errorCategory: string | null;
  lastSuccessAt: string | null;
  nextRetryAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SourceRun {
  id: number;
  sourceCode: SourceId;
  window: SourceWindow;
  cursor: string | null;
  status: SourceCheckpointStatus;
  receivedCount: number;
  persistedCount: number;
  createdCount: number;
  updatedCount: number;
  errorCategory: string | null;
  errorMessage: string | null;
  startedAt: string;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PersistOpportunityPageInput {
  sourceCode: SourceId;
  window: SourceWindow;
  cursor: string | null;
  nextCursor: string | null;
  items: OpportunityInput[];
}

export interface PersistMarketPageInput {
  sourceCode: SourceId;
  window: SourceWindow;
  items: MarketObservationInput[];
}

interface CheckpointRow {
  source_code: SourceId;
  window_start: string;
  window_end: string;
  cursor: string | null;
  status: SourceCheckpointStatus;
  received_count: number;
  persisted_count: number;
  created_count: number;
  updated_count: number;
  error_category: string | null;
  last_success_at: string | null;
  next_retry_at: string | null;
  created_at: string;
  updated_at: string;
}

interface MarketObservationRow {
  id: number;
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
  observed_at: string;
  opportunity_id: number | null;
  source_url: string;
  raw_json: string;
  created_at: string;
  updated_at: string;
}

export interface PersistPageResult {
  created: number;
  updated: number;
  checkpoint: SourceCheckpoint;
}

export class SourceSyncRepository {
  constructor(
    private readonly db: SqliteDatabase,
    private readonly opportunities = new OpportunityRepository(db),
  ) {}

  persistOpportunityPage(input: PersistOpportunityPageInput): PersistPageResult {
    const result = this.db.transaction(() => {
      this.ensureCheckpoint(input.sourceCode, input.window, input.cursor);
      let created = 0;
      let updated = 0;
      for (const item of input.items) {
        const persisted = this.opportunities.upsert({
          ...item,
          source: item.source ?? input.sourceCode,
          sourceCode: item.sourceCode ?? input.sourceCode,
        });
        if (persisted.created) created += 1;
        else updated += 1;
      }
      const now = new Date().toISOString();
      this.db.prepare(`
        UPDATE source_checkpoints
        SET cursor = ?,
            status = ?,
            received_count = received_count + ?,
            persisted_count = persisted_count + ?,
            created_count = created_count + ?,
            updated_count = updated_count + ?,
            error_category = NULL,
            last_success_at = CASE WHEN ? = 'COMPLETED' THEN ? ELSE last_success_at END,
            next_retry_at = NULL,
            updated_at = ?
        WHERE source_code = ? AND window_start = ? AND window_end = ?
      `).run(
        input.nextCursor,
        input.nextCursor === null ? 'COMPLETED' : 'RUNNING',
        input.items.length,
        input.items.length,
        created,
        updated,
        input.nextCursor === null ? 'COMPLETED' : 'RUNNING',
        now,
        now,
        input.sourceCode,
        input.window.dateFrom,
        input.window.dateTo,
      );
      return { created, updated };
    })();

    return {
      ...result,
      checkpoint: this.getCheckpoint(input.sourceCode, input.window) as SourceCheckpoint,
    };
  }

  persistMarketPage(input: PersistMarketPageInput): { created: number; updated: number } {
    return this.db.transaction(() => {
      let created = 0;
      let updated = 0;
      const statement = this.db.prepare(`
        INSERT INTO market_observations (
          source_code, external_id, item_code, normalized_description, unit, quantity,
          unit_price_cents, total_price_cents, organization, state, observed_at,
          opportunity_id, source_url, raw_json, created_at, updated_at
        ) VALUES (
          @sourceCode, @externalId, @itemCode, @normalizedDescription, @unit, @quantity,
          @unitPriceCents, @totalPriceCents, @organization, @state, @observedAt,
          @opportunityId, @sourceUrl, @rawJson, @now, @now
        )
        ON CONFLICT(source_code, external_id, item_code) DO UPDATE SET
          normalized_description = excluded.normalized_description,
          unit = excluded.unit,
          quantity = excluded.quantity,
          unit_price_cents = excluded.unit_price_cents,
          total_price_cents = excluded.total_price_cents,
          organization = excluded.organization,
          state = excluded.state,
          observed_at = excluded.observed_at,
          opportunity_id = excluded.opportunity_id,
          source_url = excluded.source_url,
          raw_json = excluded.raw_json,
          updated_at = excluded.updated_at
      `);
      const exists = this.db.prepare(`
        SELECT 1 FROM market_observations
        WHERE source_code = ? AND external_id = ? AND item_code = ?
      `);
      for (const item of input.items) {
        const now = new Date().toISOString();
        const itemCode = item.itemCode ?? '';
        const alreadyExists = exists.get(input.sourceCode, item.externalId, itemCode) !== undefined;
        const result = statement.run({
          sourceCode: item.sourceCode ?? item.source ?? input.sourceCode,
          externalId: item.externalId,
          itemCode,
          normalizedDescription: item.normalizedDescription.trim(),
          unit: item.unit.trim(),
          quantity: item.quantity,
          unitPriceCents: item.unitPriceCents ?? null,
          totalPriceCents: item.totalPriceCents ?? null,
          organization: item.organization?.trim() ?? '',
          state: item.state?.trim() ?? '',
          observedAt: item.observedAt,
          opportunityId: item.opportunityId ?? null,
          sourceUrl: item.sourceUrl,
          rawJson: JSON.stringify(sanitizePayload(item.raw ?? {})),
          now,
        });
        if (result.changes === 1 && !alreadyExists) created += 1;
        else updated += 1;
      }
      return { created, updated };
    })();
  }

  listMarketObservations(sourceCode?: SourceId): Array<{
    id: number;
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
    observedAt: string;
    opportunityId: number | null;
    sourceUrl: string;
    raw: unknown;
    createdAt: string;
    updatedAt: string;
  }> {
    const rows = this.db.prepare(`
      SELECT * FROM market_observations
      WHERE (? IS NULL OR source_code = ?)
      ORDER BY observed_at DESC, id DESC
    `).all(sourceCode ?? null, sourceCode ?? null) as MarketObservationRow[];
    return rows.map((row) => ({
      id: row.id,
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
      observedAt: row.observed_at,
      opportunityId: row.opportunity_id,
      sourceUrl: row.source_url,
      raw: JSON.parse(row.raw_json) as unknown,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  getCheckpoint(sourceCode: SourceId, window: SourceWindow): SourceCheckpoint | undefined {
    const row = this.db.prepare(`
      SELECT * FROM source_checkpoints
      WHERE source_code = ? AND window_start = ? AND window_end = ?
    `).get(sourceCode, window.dateFrom, window.dateTo) as CheckpointRow | undefined;
    return row ? mapCheckpoint(row) : undefined;
  }

  getResumeCursor(sourceCode: SourceId, window: SourceWindow): string | null {
    const checkpoint = this.getCheckpoint(sourceCode, window);
    return checkpoint?.status === 'COMPLETED' ? null : checkpoint?.cursor ?? null;
  }

  recordFailure(
    sourceCode: SourceId,
    window: SourceWindow,
    errorCategory: string,
    nextRetryAt: string | null = null,
  ): SourceCheckpoint {
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO source_checkpoints (
        source_code, window_start, window_end, cursor, status, error_category,
        next_retry_at, created_at, updated_at
      ) VALUES (?, ?, ?, NULL, 'FAILED', ?, ?, ?, ?)
      ON CONFLICT(source_code, window_start, window_end) DO UPDATE SET
        status = 'FAILED', error_category = excluded.error_category,
        next_retry_at = excluded.next_retry_at, updated_at = excluded.updated_at
    `).run(sourceCode, window.dateFrom, window.dateTo, errorCategory, nextRetryAt, now, now);
    return this.getCheckpoint(sourceCode, window) as SourceCheckpoint;
  }

  beginRun(sourceCode: SourceId, window: SourceWindow, cursor: string | null = null): number {
    const now = new Date().toISOString();
    this.ensureCheckpoint(sourceCode, window, cursor);
    const result = this.db.prepare(`
      INSERT INTO source_runs (
        source_code, window_start, window_end, cursor, status, started_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'RUNNING', ?, ?, ?)
    `).run(sourceCode, window.dateFrom, window.dateTo, cursor, now, now, now);
    return Number(result.lastInsertRowid);
  }

  completeRun(id: number, counts: { receivedCount: number; persistedCount: number; createdCount: number; updatedCount: number }): void {
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE source_runs
      SET status = 'COMPLETED', received_count = ?, persisted_count = ?, created_count = ?, updated_count = ?,
          finished_at = ?, updated_at = ?
      WHERE id = ?
    `).run(counts.receivedCount, counts.persistedCount, counts.createdCount, counts.updatedCount, now, now, id);
  }

  failRun(id: number, errorCategory: string, errorMessage: string): void {
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE source_runs
      SET status = 'FAILED', error_category = ?, error_message = ?, finished_at = ?, updated_at = ?
      WHERE id = ?
    `).run(errorCategory, errorMessage.slice(0, 500), now, now, id);
  }

  private ensureCheckpoint(sourceCode: SourceId, window: SourceWindow, cursor: string | null): void {
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO source_checkpoints (
        source_code, window_start, window_end, cursor, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'RUNNING', ?, ?)
      ON CONFLICT(source_code, window_start, window_end) DO UPDATE SET
        status = CASE WHEN source_checkpoints.status = 'COMPLETED' THEN 'RUNNING' ELSE source_checkpoints.status END,
        updated_at = excluded.updated_at
    `).run(sourceCode, window.dateFrom, window.dateTo, cursor, now, now);
  }
}

function mapCheckpoint(row: CheckpointRow): SourceCheckpoint {
  return {
    sourceCode: row.source_code,
    window: { dateFrom: row.window_start, dateTo: row.window_end },
    cursor: row.cursor,
    status: row.status,
    receivedCount: row.received_count,
    persistedCount: row.persisted_count,
    createdCount: row.created_count,
    updatedCount: row.updated_count,
    errorCategory: row.error_category,
    lastSuccessAt: row.last_success_at,
    nextRetryAt: row.next_retry_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function sanitizePayload(value: unknown, depth = 0): unknown {
  if (depth > 5) return '[truncated]';
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => sanitizePayload(item, depth + 1));
  if (typeof value !== 'object' || value === null) {
    return typeof value === 'string' ? value.slice(0, 2_000) : value;
  }
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (/token|secret|password|authorization|cookie|api[-_]?key/i.test(key)) {
      output[key] = '[redacted]';
    } else {
      output[key] = sanitizePayload(item, depth + 1);
    }
  }
  return output;
}
