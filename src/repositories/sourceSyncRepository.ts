import type { SqliteDatabase } from '../db/database';
import type {
  MarketObservationInput,
  MarketResultInput,
  SourceId,
  SourceFlow,
  SourceWindow,
} from '../domain/sourceTypes';
import type { Opportunity, OpportunityInput } from '../domain/types';
import { OpportunityRepository } from './opportunityRepository';
import { OperationalOutboxRepository } from './operationalOutboxRepository';

export type SourceCheckpointStatus = 'RUNNING' | 'COMPLETED' | 'FAILED';
export type { SourceFlow } from '../domain/sourceTypes';

export interface SourceCheckpoint {
  sourceCode: SourceId;
  flow: SourceFlow;
  scopeKey: string;
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
  flow: SourceFlow;
  scopeKey: string;
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
  scopeKey?: string;
  organizationId?: number | null;
  radarId?: number | null;
}

export interface PersistMarketPageInput {
  sourceCode: SourceId;
  window: SourceWindow;
  items: MarketObservationInput[];
}

export interface PersistMarketResultsPageInput {
  sourceCode: SourceId;
  window: SourceWindow;
  items: MarketResultInput[];
}

export interface PersistMarketBundlePageInput {
  sourceCode: SourceId;
  window: SourceWindow;
  cursor: string | null;
  nextCursor: string | null;
  observations: MarketObservationInput[];
  results: MarketResultInput[];
  scopeKey?: string;
}

interface CheckpointRow {
  source_code: SourceId;
  flow: SourceFlow;
  scope_key: string;
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

interface SourceRunRow {
  id: number;
  source_code: SourceId;
  flow: SourceFlow;
  scope_key: string;
  window_start: string;
  window_end: string;
  cursor: string | null;
  status: SourceCheckpointStatus;
  received_count: number;
  persisted_count: number;
  created_count: number;
  updated_count: number;
  error_category: string | null;
  error_message: string | null;
  started_at: string;
  finished_at: string | null;
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

interface MarketResultRow {
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
  opportunity_id: number | null;
  winner: string | null;
  awarded_price_cents: number | null;
  status: string | null;
  observed_at: string;
  source_url: string;
  raw_json: string;
  created_at: string;
  updated_at: string;
}

export interface PersistPageResult {
  created: number;
  updated: number;
  persisted: number;
  checkpoint: SourceCheckpoint;
  entries?: Array<{ previous?: Opportunity; current: Opportunity }>;
}

export class SourceSyncRepository {
  private readonly outbox: OperationalOutboxRepository;

  constructor(
    private readonly db: SqliteDatabase,
    private readonly opportunities = new OpportunityRepository(db),
  ) {
    this.outbox = new OperationalOutboxRepository(db);
  }

  persistOpportunityPage(input: PersistOpportunityPageInput): PersistPageResult {
    assertSourceItems(input.sourceCode, input.items);
    const scopeKey = input.scopeKey ?? 'default';
    const result = this.db.transaction(() => {
      this.ensureCheckpoint(input.sourceCode, 'opportunity', scopeKey, input.window, input.cursor);
      let created = 0;
      let updated = 0;
      let persistedCount = 0;
      const entries: Array<{ previous?: Opportunity; current: Opportunity }> = [];
      for (const item of input.items) {
        const existing = this.opportunities.findByPncpId(item.pncpId);
        if (existing && sourcePriority(existing.sourceCode) < sourcePriority(input.sourceCode)) continue;
        const persisted = this.opportunities.upsert({
          ...item,
          source: input.sourceCode,
          sourceCode: input.sourceCode,
        });
        persistedCount += 1;
        entries.push({ previous: persisted.previous, current: persisted.current });
        this.outbox.enqueue({
          eventKey: `opportunity-sync:${input.sourceCode}:${scopeKey}:${input.organizationId ?? 'global'}:${persisted.current.id}:${persisted.current.updatedAt}`,
          eventType: 'OPPORTUNITY_SYNCED',
          organizationId: input.organizationId,
          radarId: input.radarId,
          payload: { previous: persisted.previous, current: persisted.current },
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
        WHERE source_code = ? AND flow = 'opportunity' AND scope_key = ? AND window_start = ? AND window_end = ?
      `).run(
        input.nextCursor,
        input.nextCursor === null ? 'COMPLETED' : 'RUNNING',
        input.items.length,
        persistedCount,
        created,
        updated,
        input.nextCursor === null ? 'COMPLETED' : 'RUNNING',
        now,
        now,
        input.sourceCode,
        scopeKey,
        input.window.dateFrom,
        input.window.dateTo,
      );
      return { created, updated, persisted: persistedCount, entries };
    })();

    return {
      ...result,
      checkpoint: this.getCheckpoint(input.sourceCode, input.window, 'opportunity', scopeKey) as SourceCheckpoint,
    };
  }

  persistMarketPage(input: PersistMarketPageInput): { created: number; updated: number } {
    assertMarketItems(input.sourceCode, input.items);
    return this.db.transaction(() => this.persistMarketObservations(input.items, input.sourceCode))();
  }

  persistMarketResultsPage(input: PersistMarketResultsPageInput): { created: number; updated: number } {
    assertMarketItems(input.sourceCode, input.items);
    return this.db.transaction(() => this.persistMarketResults(input.items, input.sourceCode))();
  }

  persistMarketBundlePage(input: PersistMarketBundlePageInput): PersistPageResult {
    assertMarketItems(input.sourceCode, input.observations);
    assertMarketItems(input.sourceCode, input.results);
    const scopeKey = input.scopeKey ?? 'default';
    const result = this.db.transaction(() => {
      this.ensureCheckpoint(input.sourceCode, 'market', scopeKey, input.window, input.cursor);
      const observations = this.persistMarketObservations(input.observations, input.sourceCode);
      const results = this.persistMarketResults(input.results, input.sourceCode);
      const now = new Date().toISOString();
      this.advanceCheckpoint(
        input.sourceCode,
        'market',
        scopeKey,
        input.window,
        input.nextCursor,
        input.observations.length + input.results.length,
        input.observations.length + input.results.length,
        observations.created + results.created,
        observations.updated + results.updated,
        now,
      );
      return {
        created: observations.created + results.created,
        updated: observations.updated + results.updated,
        persisted: input.observations.length + input.results.length,
      };
    })();

    return {
      ...result,
      checkpoint: this.getCheckpoint(input.sourceCode, input.window, 'market', scopeKey) as SourceCheckpoint,
    };
  }

  private persistMarketObservations(items: MarketObservationInput[], sourceCode: SourceId): { created: number; updated: number } {
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
    for (const item of items) {
        const now = new Date().toISOString();
        const itemCode = item.itemCode ?? '';
        const alreadyExists = exists.get(sourceCode, item.externalId, itemCode) !== undefined;
        const result = statement.run({
          sourceCode,
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
          sourceUrl: item.sourceUrl.trim(),
          rawJson: JSON.stringify(marketRawJson(item.raw, { modality: item.modality, status: item.status })),
          now,
        });
        if (result.changes === 1 && !alreadyExists) created += 1;
        else updated += 1;
    }
    return { created, updated };
  }

  private persistMarketResults(items: MarketResultInput[], sourceCode: SourceId): { created: number; updated: number } {
    let created = 0;
    let updated = 0;
    const statement = this.db.prepare(`
        INSERT INTO market_results (
          source_code, external_id, item_code, normalized_description, unit, quantity,
          unit_price_cents, total_price_cents, organization, state, opportunity_id,
          winner, awarded_price_cents, status, observed_at, source_url, raw_json, created_at, updated_at
        ) VALUES (
          @sourceCode, @externalId, @itemCode, @normalizedDescription, @unit, @quantity,
          @unitPriceCents, @totalPriceCents, @organization, @state, @opportunityId,
          @winner, @awardedPriceCents, @status, @observedAt, @sourceUrl, @rawJson, @now, @now
        )
        ON CONFLICT(source_code, external_id, item_code) DO UPDATE SET
          normalized_description = excluded.normalized_description,
          unit = excluded.unit,
          quantity = excluded.quantity,
          unit_price_cents = excluded.unit_price_cents,
          total_price_cents = excluded.total_price_cents,
          organization = excluded.organization,
          state = excluded.state,
          opportunity_id = excluded.opportunity_id,
          winner = excluded.winner,
          awarded_price_cents = excluded.awarded_price_cents,
          status = excluded.status,
          observed_at = excluded.observed_at,
          source_url = excluded.source_url,
          raw_json = excluded.raw_json,
          updated_at = excluded.updated_at
      `);
      const exists = this.db.prepare(`
        SELECT 1 FROM market_results
        WHERE source_code = ? AND external_id = ? AND item_code = ?
      `);
    for (const item of items) {
        const now = new Date().toISOString();
        const itemCode = item.itemCode ?? '';
        const alreadyExists = exists.get(sourceCode, item.externalId, itemCode) !== undefined;
        const result = statement.run({
          sourceCode,
          externalId: item.externalId,
          itemCode,
          normalizedDescription: item.normalizedDescription.trim(),
          unit: item.unit.trim(),
          quantity: item.quantity,
          unitPriceCents: item.unitPriceCents ?? null,
          totalPriceCents: item.totalPriceCents ?? null,
          organization: item.organization?.trim() ?? '',
          state: item.state?.trim() ?? '',
          opportunityId: item.opportunityId ?? null,
          winner: item.winner ?? null,
          awardedPriceCents: item.awardedPriceCents ?? null,
          status: item.status ?? null,
          observedAt: item.observedAt,
          sourceUrl: item.sourceUrl.trim(),
          rawJson: JSON.stringify(marketRawJson(item.raw, { modality: item.modality })),
          now,
        });
        if (result.changes === 1 && !alreadyExists) created += 1;
        else updated += 1;
    }
    return { created, updated };
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

  listMarketResults(sourceCode?: SourceId): Array<{
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
    opportunityId: number | null;
    winner: string | null;
    awardedPriceCents: number | null;
    status: string | null;
    observedAt: string;
    sourceUrl: string;
    raw: unknown;
    createdAt: string;
    updatedAt: string;
  }> {
    const rows = this.db.prepare(`
      SELECT * FROM market_results
      WHERE (? IS NULL OR source_code = ?)
      ORDER BY observed_at DESC, id DESC
    `).all(sourceCode ?? null, sourceCode ?? null) as MarketResultRow[];
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
      opportunityId: row.opportunity_id,
      winner: row.winner,
      awardedPriceCents: row.awarded_price_cents,
      status: row.status,
      observedAt: row.observed_at,
      sourceUrl: row.source_url,
      raw: JSON.parse(row.raw_json) as unknown,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  getCheckpoint(sourceCode: SourceId, window: SourceWindow, flow?: SourceFlow, scopeKey = 'default'): SourceCheckpoint | undefined {
    const requestedFlow = flow ?? 'opportunity';
    const row = this.db.prepare(`
      SELECT * FROM source_checkpoints
      WHERE source_code = ? AND flow = ? AND scope_key = ? AND window_start = ? AND window_end = ?
    `).get(sourceCode, requestedFlow, scopeKey, window.dateFrom, window.dateTo) as CheckpointRow | undefined;
    if (row || flow !== undefined) return row ? mapCheckpoint(row) : undefined;
    const compatibleMarketRows = this.db.prepare(`
      SELECT * FROM source_checkpoints
      WHERE source_code = ? AND flow = 'market' AND window_start = ? AND window_end = ?
      ORDER BY updated_at DESC
      LIMIT 2
    `).all(sourceCode, window.dateFrom, window.dateTo) as CheckpointRow[];
    return compatibleMarketRows.length === 1 && compatibleMarketRows[0]
      ? mapCheckpoint(compatibleMarketRows[0])
      : undefined;
  }

  getResumeCursor(sourceCode: SourceId, window: SourceWindow, flow?: SourceFlow, scopeKey = 'default'): string | null {
    const checkpoint = this.getCheckpoint(sourceCode, window, flow, scopeKey);
    return checkpoint?.status === 'COMPLETED' ? null : checkpoint?.cursor ?? null;
  }

  recordFailure(
    sourceCode: SourceId,
    window: SourceWindow,
    errorCategory: string,
    nextRetryAt: string | null = null,
    flow: SourceFlow = 'opportunity',
    scopeKey = 'default',
  ): SourceCheckpoint {
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO source_checkpoints (
        source_code, flow, scope_key, window_start, window_end, cursor, status, error_category,
        next_retry_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, NULL, 'FAILED', ?, ?, ?, ?)
      ON CONFLICT(source_code, flow, scope_key, window_start, window_end) DO UPDATE SET
        status = 'FAILED', error_category = excluded.error_category,
        next_retry_at = excluded.next_retry_at, updated_at = excluded.updated_at
    `).run(sourceCode, flow, scopeKey, window.dateFrom, window.dateTo, errorCategory, nextRetryAt, now, now);
    return this.getCheckpoint(sourceCode, window, flow, scopeKey) as SourceCheckpoint;
  }

  beginRun(sourceCode: SourceId, window: SourceWindow, cursor: string | null = null, flow: SourceFlow = 'opportunity', scopeKey = 'default'): number {
    const now = new Date().toISOString();
    this.ensureCheckpoint(sourceCode, flow, scopeKey, window, cursor);
    const result = this.db.prepare(`
      INSERT INTO source_runs (
        source_code, flow, scope_key, window_start, window_end, cursor, status, started_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'RUNNING', ?, ?, ?)
    `).run(sourceCode, flow, scopeKey, window.dateFrom, window.dateTo, cursor, now, now, now);
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

  listRuns(options: { sourceCode?: SourceId; flow?: SourceFlow; scopeKey?: string; limit?: number } = {}): SourceRun[] {
    const conditions: string[] = [];
    const params: Array<string | number> = [];
    if (options.sourceCode) {
      conditions.push('source_code = ?');
      params.push(options.sourceCode);
    }
    if (options.flow) {
      conditions.push('flow = ?');
      params.push(options.flow);
    }
    if (options.scopeKey) {
      conditions.push('scope_key = ?');
      params.push(options.scopeKey);
    }
    const where = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '';
    const limit = Math.max(1, Math.floor(options.limit ?? 100));
    const rows = this.db.prepare(`
      SELECT * FROM source_runs${where} ORDER BY started_at DESC, id DESC LIMIT ?
    `).all(...params, limit) as SourceRunRow[];
    return rows.map(mapSourceRun);
  }

  private ensureCheckpoint(sourceCode: SourceId, flow: SourceFlow, scopeKey: string, window: SourceWindow, cursor: string | null): void {
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO source_checkpoints (
        source_code, flow, scope_key, window_start, window_end, cursor, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'RUNNING', ?, ?)
      ON CONFLICT(source_code, flow, scope_key, window_start, window_end) DO UPDATE SET
        status = CASE WHEN source_checkpoints.status = 'COMPLETED' THEN 'RUNNING' ELSE source_checkpoints.status END,
        updated_at = excluded.updated_at
    `).run(sourceCode, flow, scopeKey, window.dateFrom, window.dateTo, cursor, now, now);
  }

  private advanceCheckpoint(
    sourceCode: SourceId,
    flow: SourceFlow,
    scopeKey: string,
    window: SourceWindow,
    cursor: string | null,
    received: number,
    persisted: number,
    created: number,
    updated: number,
    now: string,
  ): void {
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
      WHERE source_code = ? AND flow = ? AND scope_key = ? AND window_start = ? AND window_end = ?
    `).run(
      cursor,
      cursor === null ? 'COMPLETED' : 'RUNNING',
      received,
      persisted,
      created,
      updated,
      cursor === null ? 'COMPLETED' : 'RUNNING',
      now,
      now,
      sourceCode,
      flow,
      scopeKey,
      window.dateFrom,
      window.dateTo,
    );
  }
}

function mapCheckpoint(row: CheckpointRow): SourceCheckpoint {
  return {
    sourceCode: row.source_code,
    flow: row.flow,
    scopeKey: row.scope_key,
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

function mapSourceRun(row: SourceRunRow): SourceRun {
  return {
    id: row.id,
    sourceCode: row.source_code,
    flow: row.flow,
    scopeKey: row.scope_key,
    window: { dateFrom: row.window_start, dateTo: row.window_end },
    cursor: row.cursor,
    status: row.status,
    receivedCount: row.received_count,
    persistedCount: row.persisted_count,
    createdCount: row.created_count,
    updatedCount: row.updated_count,
    errorCategory: row.error_category,
    errorMessage: row.error_message,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function sourcePriority(source: SourceId): number {
  if (source === 'PNCP') return 0;
  if (source === 'OPEN_DATA') return 1;
  return 2;
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

function assertSourceItems(
  sourceCode: SourceId,
  items: Array<{ sourceCode?: SourceId; source?: SourceId }>,
): void {
  for (const item of items) {
    if ((item.sourceCode !== undefined && item.sourceCode !== sourceCode)
      || (item.source !== undefined && item.source !== sourceCode)) {
      throw new Error(`Page sourceCode ${sourceCode} does not match item sourceCode`);
    }
  }
}

function assertMarketItems(
  sourceCode: SourceId,
  items: Array<{
    sourceCode?: SourceId;
    source?: SourceId;
    externalId: string;
    normalizedDescription: string;
    unit: string;
    quantity: number;
    unitPriceCents?: number | null;
    totalPriceCents?: number | null;
    awardedPriceCents?: number | null;
    sourceUrl: string;
  }>,
): void {
  assertSourceItems(sourceCode, items);
  for (const item of items) {
    if (!item.externalId?.trim()) throw new Error('Market item requires externalId');
    if (!item.normalizedDescription?.trim()) throw new Error('Market item requires normalizedDescription');
    if (!item.unit?.trim()) throw new Error('Market item requires unit');
    if (!Number.isFinite(item.quantity) || item.quantity < 0) throw new Error('Market item requires a valid quantity');
    if (!item.sourceUrl?.trim()) throw new Error('Market item requires sourceUrl');
    for (const [field, value] of Object.entries({
      unitPriceCents: item.unitPriceCents,
      totalPriceCents: item.totalPriceCents,
      awardedPriceCents: item.awardedPriceCents,
    })) {
      if (value !== null && value !== undefined && (!Number.isSafeInteger(value) || value < 0)) {
        throw new Error(`Market item requires a valid ${field}`);
      }
    }
  }
}

function marketRawJson(raw: unknown, metadata: { modality?: string | null; status?: string | null }): unknown {
  const hasMetadata = Boolean(metadata.modality?.trim() || metadata.status?.trim());
  const sanitized = sanitizePayload(raw ?? {});
  if (!hasMetadata) return sanitized;
  if (isRecord(sanitized)) return { ...sanitized, marketMetadata: metadata };
  return { value: sanitized, marketMetadata: metadata };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
