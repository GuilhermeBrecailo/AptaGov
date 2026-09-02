import type { OpportunityInput, FilterConfig } from '../../domain/types';
import {
  type MarketObservationInput,
  type MarketQuery,
  type SourceId,
  type SourcePage,
  type SourceQuery,
  type SourceWindow,
} from '../../domain/sourceTypes';
import { paginatePages } from '../pncp/paginator';
import type { PncpClient, PublishedQuery } from '../pncp/PncpClient';
import type { OpenDataClient } from '../pncp/OpenDataClient';
import { mapPncpRecord } from '../../services/syncService';
import type { SourceSyncRepository } from '../../repositories/sourceSyncRepository';

export interface OfficialSourceClient {
  readonly id: SourceId;
  listOpportunities(query: SourceQuery): Promise<SourcePage<OpportunityInput>>;
  listMarketObservations(query: MarketQuery): Promise<SourcePage<MarketObservationInput>>;
}

export interface PagedOfficialSourceClient extends OfficialSourceClient {
  listOpportunityPages(query: SourceQuery): AsyncIterable<SourcePage<OpportunityInput>>;
  listMarketObservationPages(query: MarketQuery): AsyncIterable<SourcePage<MarketObservationInput>>;
}

type PaginatedSourceClient = Pick<PncpClient | OpenDataClient, 'fetchPublishedPage'>;

export interface PncpSourceClientOptions {
  sourceClient: PaginatedSourceClient;
}

export class PncpSourceClient implements PagedOfficialSourceClient {
  readonly id = 'PNCP' as const;

  constructor(private readonly options: PncpSourceClientOptions) {}

  async listOpportunities(query: SourceQuery): Promise<SourcePage<OpportunityInput>> {
    return collectPages(this.listOpportunityPages(query));
  }

  async *listOpportunityPages(query: SourceQuery): AsyncGenerator<SourcePage<OpportunityInput>> {
    for await (const batch of this.fetchPages(query)) {
      yield {
        items: batch.response.data.map((record) => ({ ...mapPncpRecord(record, 'PNCP'), sourceCode: 'PNCP' })),
        nextCursor: batch.nextPage === null ? null : `page:${batch.nextPage}`,
        hasNext: batch.hasNext,
        fetchedAt: new Date().toISOString(),
      };
    }
  }

  async listMarketObservations(query: MarketQuery): Promise<SourcePage<MarketObservationInput>> {
    return collectPages(this.listMarketObservationPages(query));
  }

  async *listMarketObservationPages(query: MarketQuery): AsyncGenerator<SourcePage<MarketObservationInput>> {
    for await (const batch of this.fetchPages(query)) {
      yield {
        items: batch.response.data.flatMap((record) => marketObservationFromRecord(record, 'PNCP', query)),
        nextCursor: batch.nextPage === null ? null : `page:${batch.nextPage}`,
        hasNext: batch.hasNext,
        fetchedAt: new Date().toISOString(),
      };
    }
  }

  private fetchPages(query: SourceQuery) {
    return paginatePages(
      (page) => this.options.sourceClient.fetchPublishedPage(toPublishedQuery(query), page),
      cursorToPage(query.cursor),
    );
  }
}

export interface OpenDataSourceClientOptions {
  sourceClient: PaginatedSourceClient;
}

export class OpenDataSourceClient implements PagedOfficialSourceClient {
  readonly id = 'OPEN_DATA' as const;

  constructor(private readonly options: OpenDataSourceClientOptions) {}

  async listOpportunities(query: SourceQuery): Promise<SourcePage<OpportunityInput>> {
    return collectPages(this.listOpportunityPages(query));
  }

  async *listOpportunityPages(query: SourceQuery): AsyncGenerator<SourcePage<OpportunityInput>> {
    for await (const batch of this.fetchPages(query)) {
      yield {
        items: batch.response.data.map((record) => ({ ...mapPncpRecord(record, 'OPEN_DATA'), sourceCode: 'OPEN_DATA' })),
        nextCursor: batch.nextPage === null ? null : `page:${batch.nextPage}`,
        hasNext: batch.hasNext,
        fetchedAt: new Date().toISOString(),
      };
    }
  }

  async listMarketObservations(query: MarketQuery): Promise<SourcePage<MarketObservationInput>> {
    return collectPages(this.listMarketObservationPages(query));
  }

  async *listMarketObservationPages(query: MarketQuery): AsyncGenerator<SourcePage<MarketObservationInput>> {
    for await (const batch of this.fetchPages(query)) {
      yield {
        items: batch.response.data.flatMap((record) => marketObservationFromRecord(record, 'OPEN_DATA', query)),
        nextCursor: batch.nextPage === null ? null : `page:${batch.nextPage}`,
        hasNext: batch.hasNext,
        fetchedAt: new Date().toISOString(),
      };
    }
  }

  private fetchPages(query: SourceQuery) {
    return paginatePages(
      (page) => this.options.sourceClient.fetchPublishedPage(toPublishedQuery(query), page),
      cursorToPage(query.cursor),
    );
  }
}

export interface SourceRunResult<T> {
  source: SourceId;
  page?: T;
  error?: unknown;
}

export async function runSourcesIndependently<
  TClient extends { id: SourceId },
  TResult,
>(
  clients: readonly TClient[],
  operation: (client: TClient) => Promise<TResult>,
): Promise<SourceRunResult<TResult>[]> {
  return Promise.all(clients.map(async (client) => {
    try {
      return { source: client.id, page: await operation(client) };
    } catch (error) {
      return { source: client.id, error };
    }
  }));
}

export interface SourceSyncResult {
  received: number;
  persisted: number;
  created: number;
  updated: number;
}

export async function syncSourceOpportunities(
  client: PagedOfficialSourceClient,
  query: SourceQuery,
  repository: SourceSyncRepository,
): Promise<SourceSyncResult> {
  const window: SourceWindow = { dateFrom: query.dateFrom, dateTo: query.dateTo };
  let cursor = repository.getResumeCursor(client.id, window);
  const result: SourceSyncResult = { received: 0, persisted: 0, created: 0, updated: 0 };

  try {
    for await (const page of client.listOpportunityPages({ ...query, cursor })) {
      const persisted = repository.persistOpportunityPage({
        sourceCode: client.id,
        window,
        cursor,
        nextCursor: page.nextCursor,
        items: page.items,
      });
      result.received += page.items.length;
      result.persisted += page.items.length;
      result.created += persisted.created;
      result.updated += persisted.updated;
      cursor = page.nextCursor;
    }
    return result;
  } catch (error) {
    repository.recordFailure(client.id, window, sourceErrorCategory(error));
    throw error;
  }
}

async function collectPages<T>(pages: AsyncIterable<SourcePage<T>>): Promise<SourcePage<T>> {
  const items: T[] = [];
  let fetchedAt = new Date().toISOString();
  for await (const page of pages) {
    items.push(...page.items);
    fetchedAt = page.fetchedAt;
  }
  return { items, nextCursor: null, hasNext: false, fetchedAt };
}

function sourceErrorCategory(error: unknown): string {
  if (error instanceof Error && error.name === 'AbortError') return 'TIMEOUT';
  if (typeof error === 'object' && error !== null && 'status' in error) {
    const status = Number((error as { status: unknown }).status);
    if (status === 429) return 'RATE_LIMITED';
    if (status >= 500) return 'UNAVAILABLE';
  }
  return 'SYNC_FAILED';
}

function toPublishedQuery(query: SourceQuery): PublishedQuery {
  return {
    dateFrom: query.dateFrom,
    dateTo: query.dateTo,
    state: firstFilter(query.filters, 'states'),
    cityIbge: firstFilter(query.filters, 'citiesIbge'),
    modality: firstFilter(query.filters, 'modalities'),
  };
}

function firstFilter(filters: FilterConfig, key: 'states' | 'citiesIbge' | 'modalities'): string | undefined {
  return filters[key][0];
}

function cursorToPage(cursor: string | null | undefined): number {
  if (!cursor) return 1;
  const match = /^(?:page:)?(\d+)$/.exec(cursor);
  const page = match ? Number(match[1]) : 1;
  return Number.isSafeInteger(page) && page > 0 ? page : 1;
}

function marketObservationFromRecord(
  record: Record<string, unknown>,
  sourceCode: SourceId,
  query: MarketQuery,
): MarketObservationInput[] {
  const itemCode = firstString(record.codigoItem, record.codItemCatalogo, record.itemCode);
  const description = firstString(record.descricaoItem, record.objetoCompra, record.objeto);
  if (!itemCode || !description) return [];
  const quantity = firstNumber(record.quantidade, record.quantity) ?? 0;
  return [{
    sourceCode,
    externalId: firstString(record.numeroControlePNCP, record.id) ?? `${sourceCode}:${itemCode}:${query.dateFrom}`,
    itemCode,
    normalizedDescription: normalizeDescription(description),
    unit: firstString(record.unidadeFornecimento, record.unidade, record.unit) ?? '',
    quantity,
    unitPriceCents: moneyToCents(record.valorUnitario, record.precoUnitario),
    totalPriceCents: moneyToCents(record.valorTotal, record.precoTotal),
    organization: firstString(record.nomeOrgao, record.organizacao) ?? '',
    state: firstString(record.uf, record.state) ?? '',
    observedAt: firstString(record.dataResultado, record.dataPublicacaoPncp) ?? new Date().toISOString(),
    sourceUrl: firstString(record.linkSistemaOrigem, record.sourceUrl) ?? '',
    raw: record,
  }];
}

function normalizeDescription(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function firstString(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === 'string' && value.trim().length > 0);
}

function firstNumber(...values: unknown[]): number | undefined {
  return values.find((value): value is number => typeof value === 'number' && Number.isFinite(value));
}

function moneyToCents(...values: unknown[]): number | null {
  const value = values.find((candidate) => typeof candidate === 'number' || typeof candidate === 'string');
  if (value === undefined) return null;
  if (typeof value === 'number') return Math.round(value * 100);
  const parsed = Number(value.replace(/\./g, '').replace(',', '.').replace(/[^\d.-]/g, ''));
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : null;
}

export type { MarketObservationInput, MarketQuery, SourceId, SourcePage, SourceQuery };
export { BecSpClient } from './BecSpClient';
