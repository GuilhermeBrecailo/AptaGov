import type { OpportunityInput, FilterConfig } from '../../domain/types';
import {
  type MarketObservationInput,
  type MarketQuery,
  type SourceId,
  type SourcePage,
  type SourceQuery,
} from '../../domain/sourceTypes';
import { paginateAll } from '../pncp/paginator';
import type { PncpClient, PublishedQuery } from '../pncp/PncpClient';
import type { OpenDataClient } from '../pncp/OpenDataClient';
import { mapPncpRecord } from '../../services/syncService';

export interface OfficialSourceClient {
  readonly id: SourceId;
  listOpportunities(query: SourceQuery): Promise<SourcePage<OpportunityInput>>;
  listMarketObservations(query: MarketQuery): Promise<SourcePage<MarketObservationInput>>;
}

type PaginatedSourceClient = Pick<PncpClient | OpenDataClient, 'fetchPublishedPage'>;

export interface PncpSourceClientOptions {
  sourceClient: PaginatedSourceClient;
}

export class PncpSourceClient implements OfficialSourceClient {
  readonly id = 'PNCP' as const;

  constructor(private readonly options: PncpSourceClientOptions) {}

  async listOpportunities(query: SourceQuery): Promise<SourcePage<OpportunityInput>> {
    const records = await this.fetchRecords(query);
    return {
      items: records.map((record) => ({ ...mapPncpRecord(record, 'PNCP'), sourceCode: 'PNCP' })),
      nextCursor: null,
      hasNext: false,
      fetchedAt: new Date().toISOString(),
    };
  }

  async listMarketObservations(query: MarketQuery): Promise<SourcePage<MarketObservationInput>> {
    const records = await this.fetchRecords(query);
    return {
      items: records.flatMap((record) => marketObservationFromRecord(record, 'PNCP', query)),
      nextCursor: null,
      hasNext: false,
      fetchedAt: new Date().toISOString(),
    };
  }

  private fetchRecords(query: SourceQuery): Promise<Record<string, unknown>[]> {
    return paginateAll(
      (page) => this.options.sourceClient.fetchPublishedPage(toPublishedQuery(query), page),
      cursorToPage(query.cursor),
    );
  }
}

export interface OpenDataSourceClientOptions {
  sourceClient: PaginatedSourceClient;
}

export class OpenDataSourceClient implements OfficialSourceClient {
  readonly id = 'OPEN_DATA' as const;

  constructor(private readonly options: OpenDataSourceClientOptions) {}

  async listOpportunities(query: SourceQuery): Promise<SourcePage<OpportunityInput>> {
    const records = await this.fetchRecords(query);
    return {
      items: records.map((record) => ({ ...mapPncpRecord(record, 'OPEN_DATA'), sourceCode: 'OPEN_DATA' })),
      nextCursor: null,
      hasNext: false,
      fetchedAt: new Date().toISOString(),
    };
  }

  async listMarketObservations(query: MarketQuery): Promise<SourcePage<MarketObservationInput>> {
    const records = await this.fetchRecords(query);
    return {
      items: records.flatMap((record) => marketObservationFromRecord(record, 'OPEN_DATA', query)),
      nextCursor: null,
      hasNext: false,
      fetchedAt: new Date().toISOString(),
    };
  }

  private fetchRecords(query: SourceQuery): Promise<Record<string, unknown>[]> {
    return paginateAll(
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
