import type { Opportunity, OpportunityInput, FilterConfig } from '../../domain/types';
import {
  type MarketObservationInput,
  type MarketResultInput,
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
import { parseMarketMoneyToCents, parseMarketNumber } from './marketValues';

export interface OfficialSourceClient {
  readonly id: SourceId;
  listOpportunities(query: SourceQuery): Promise<SourcePage<OpportunityInput>>;
  listMarketObservations(query: MarketQuery): Promise<SourcePage<MarketObservationInput>>;
  listMarketResults(query: MarketQuery): Promise<SourcePage<MarketResultInput>>;
}

export interface MarketSourcePage extends SourcePage<MarketObservationInput> {
  results: MarketResultInput[];
}

export interface PagedOfficialSourceClient extends OfficialSourceClient {
  listOpportunityPages(query: SourceQuery): AsyncIterable<SourcePage<OpportunityInput>>;
  listMarketPages(query: MarketQuery): AsyncIterable<MarketSourcePage>;
  listMarketObservationPages(query: MarketQuery): AsyncIterable<SourcePage<MarketObservationInput>>;
  listMarketResultPages(query: MarketQuery): AsyncIterable<SourcePage<MarketResultInput>>;
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

  async listMarketResults(query: MarketQuery): Promise<SourcePage<MarketResultInput>> {
    return collectPages(this.listMarketResultPages(query));
  }

  async *listMarketPages(query: MarketQuery): AsyncGenerator<MarketSourcePage> {
    for await (const batch of this.fetchPages(query)) {
      yield {
        items: batch.response.data.flatMap((record) => marketObservationFromRecord(record, 'PNCP', query)),
        results: batch.response.data.flatMap((record) => marketResultFromRecord(record, 'PNCP', query)),
        nextCursor: batch.nextPage === null ? null : `page:${batch.nextPage}`,
        hasNext: batch.hasNext,
        fetchedAt: new Date().toISOString(),
      };
    }
  }

  async *listMarketObservationPages(query: MarketQuery): AsyncGenerator<SourcePage<MarketObservationInput>> {
    for await (const page of this.listMarketPages(query)) {
      yield { items: page.items, nextCursor: page.nextCursor, hasNext: page.hasNext, fetchedAt: page.fetchedAt };
    }
  }

  async *listMarketResultPages(query: MarketQuery): AsyncGenerator<SourcePage<MarketResultInput>> {
    for await (const page of this.listMarketPages(query)) {
      yield { items: page.results, nextCursor: page.nextCursor, hasNext: page.hasNext, fetchedAt: page.fetchedAt };
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

  async listMarketResults(query: MarketQuery): Promise<SourcePage<MarketResultInput>> {
    return collectPages(this.listMarketResultPages(query));
  }

  async *listMarketPages(query: MarketQuery): AsyncGenerator<MarketSourcePage> {
    for await (const batch of this.fetchPages(query)) {
      yield {
        items: batch.response.data.flatMap((record) => marketObservationFromRecord(record, 'OPEN_DATA', query)),
        results: batch.response.data.flatMap((record) => marketResultFromRecord(record, 'OPEN_DATA', query)),
        nextCursor: batch.nextPage === null ? null : `page:${batch.nextPage}`,
        hasNext: batch.hasNext,
        fetchedAt: new Date().toISOString(),
      };
    }
  }

  async *listMarketObservationPages(query: MarketQuery): AsyncGenerator<SourcePage<MarketObservationInput>> {
    for await (const page of this.listMarketPages(query)) {
      yield { items: page.items, nextCursor: page.nextCursor, hasNext: page.hasNext, fetchedAt: page.fetchedAt };
    }
  }

  async *listMarketResultPages(query: MarketQuery): AsyncGenerator<SourcePage<MarketResultInput>> {
    for await (const page of this.listMarketPages(query)) {
      yield { items: page.results, nextCursor: page.nextCursor, hasNext: page.hasNext, fetchedAt: page.fetchedAt };
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
  entries: Array<{ previous?: Opportunity; current: Opportunity }>;
}

export interface SourceSyncHooks {
  onEntry?: (entry: { previous?: Opportunity; current: Opportunity }) => void | Promise<void>;
}

export async function syncSourceOpportunities(
  client: PagedOfficialSourceClient,
  query: SourceQuery,
  repository: SourceSyncRepository,
  hooks: SourceSyncHooks = {},
): Promise<SourceSyncResult> {
  const window: SourceWindow = { dateFrom: query.dateFrom, dateTo: query.dateTo };
  let cursor = repository.getResumeCursor(client.id, window);
  const result: SourceSyncResult = { received: 0, persisted: 0, created: 0, updated: 0, entries: [] };

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
      for (const entry of persisted.entries ?? []) {
        result.entries.push(entry);
        await hooks.onEntry?.(entry);
      }
      cursor = page.nextCursor;
    }
    return result;
  } catch (error) {
    repository.recordFailure(client.id, window, sourceErrorCategory(error));
    throw error;
  }
}

export interface SourceMarketSyncResult extends SourceSyncResult {
  observationsReceived: number;
  resultsReceived: number;
}

export async function syncSourceMarket(
  client: PagedOfficialSourceClient,
  query: MarketQuery,
  repository: SourceSyncRepository,
): Promise<SourceMarketSyncResult> {
  const window: SourceWindow = { dateFrom: query.dateFrom, dateTo: query.dateTo };
  let cursor = repository.getResumeCursor(client.id, window);
  const result: SourceMarketSyncResult = {
    received: 0,
    persisted: 0,
    created: 0,
    updated: 0,
    entries: [],
    observationsReceived: 0,
    resultsReceived: 0,
  };

  try {
    for await (const page of client.listMarketPages({ ...query, cursor })) {
      const persisted = repository.persistMarketBundlePage({
        sourceCode: client.id,
        window,
        cursor,
        nextCursor: page.nextCursor,
        observations: page.items,
        results: page.results,
      });
      result.observationsReceived += page.items.length;
      result.resultsReceived += page.results.length;
      result.received += page.items.length + page.results.length;
      result.persisted += page.items.length + page.results.length;
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
  _query: MarketQuery,
): MarketObservationInput[] {
  const externalId = firstString(record.numeroControlePNCP, record.numeroControlePncp, record.id);
  if (!externalId) return [];
  return marketItemsFromRecord(record).flatMap((item) => {
    const itemCode = firstString(item.codigoItem, item.codItemCatalogo, item.itemCode, item.CD_ITEM, record.codigoItem, record.itemCode);
    const description = firstString(item.descricaoItem, item.descricao, item.DESCRICAO_ITEM, record.descricaoItem, record.objetoCompra, record.objeto);
    const unit = firstString(item.unidadeFornecimento, item.unidadeMedida, item.unidade, item.unit, item.UNIDADE_FORNECIMENTO, record.unidadeFornecimento, record.unidade);
    const quantity = firstMarketNumber(item.quantidade, item.quantidadeHomologada, item.quantity, record.quantidade, record.quantity);
    if (!itemCode || !description || !unit || quantity === null) return [];
    return [{
      sourceCode,
      externalId,
      itemCode,
      normalizedDescription: normalizeDescription(description),
      unit,
      quantity,
      unitPriceCents: parseMarketMoneyToCents(item.valorUnitario, item.precoUnitario, record.valorUnitario, record.precoUnitario),
      totalPriceCents: parseMarketMoneyToCents(item.valorTotal, item.precoTotal, record.valorTotal, record.precoTotal),
      organization: firstString(item.nomeOrgao, record.nomeOrgao, record.organizacao, record.orgaoEntidade && recordValue(record.orgaoEntidade)?.razaoSocial) ?? '',
      state: firstString(item.uf, record.uf, record.state) ?? '',
      modality: firstString(item.modalidadeNome, record.modalidadeNome, record.modalidade),
      status: firstString(item.situacaoCompra, item.status, record.situacaoCompra, record.statusCompra, record.situacao, record.status),
      observedAt: firstString(item.dataResultado, item.dataHomologacao, record.dataResultado, record.dataPublicacaoPncp) ?? new Date().toISOString(),
      sourceUrl: sourceUrlFor(sourceCode, record, item, externalId),
      raw: { record, item },
    }];
  });
}

function marketResultFromRecord(
  record: Record<string, unknown>,
  sourceCode: SourceId,
  _query: MarketQuery,
): MarketResultInput[] {
  const externalId = firstString(record.numeroControlePNCP, record.numeroControlePncp, record.id);
  if (!externalId) return [];
  return marketItemsFromRecord(record).flatMap((item) => {
    const itemCode = firstString(item.codigoItem, item.codItemCatalogo, item.itemCode, item.CD_ITEM, record.codigoItem, record.itemCode);
    const description = firstString(item.descricaoItem, item.descricao, item.DESCRICAO_ITEM, record.descricaoItem, record.objetoCompra, record.objeto);
    const unit = firstString(item.unidadeFornecimento, item.unidadeMedida, item.unidade, item.unit, item.UNIDADE_FORNECIMENTO, record.unidadeFornecimento, record.unidade);
    const quantity = firstMarketNumber(item.quantidade, item.quantidadeHomologada, item.quantity, record.quantidade, record.quantity);
    if (!itemCode || !description || !unit || quantity === null) return [];
    const winner = firstText(
      item.nomeRazaoSocialFornecedor,
      item.nomeFornecedor,
      item.vencedor,
      item.fornecedor,
      record.nomeRazaoSocialFornecedor,
      record.nomeFornecedor,
      record.vencedor,
    );
    return [{
      sourceCode,
      externalId,
      itemCode,
      normalizedDescription: normalizeDescription(description),
      unit,
      quantity,
      unitPriceCents: parseMarketMoneyToCents(item.valorUnitarioHomologado, item.valorUnitarioAdjudicado, item.valorUnitario, item.precoUnitario, record.valorUnitarioHomologado, record.valorUnitario),
      totalPriceCents: parseMarketMoneyToCents(item.valorTotalHomologado, item.valorTotalAdjudicado, item.valorTotal, item.precoTotal, record.valorTotalHomologado, record.valorTotal),
      organization: firstString(item.nomeOrgao, record.nomeOrgao, record.organizacao, record.orgaoEntidade && recordValue(record.orgaoEntidade)?.razaoSocial) ?? '',
      state: firstString(item.uf, record.uf, record.state) ?? '',
      opportunityId: null,
      winner: winner ?? null,
      awardedPriceCents: parseMarketMoneyToCents(item.valorTotalHomologado, item.valorTotalAdjudicado, item.valorHomologado, item.valorAdjudicado, record.valorTotalHomologado, record.valorHomologado),
      modality: firstString(item.modalidadeNome, record.modalidadeNome, record.modalidade),
      status: firstString(item.situacaoCompra, item.status, record.situacaoCompra, record.statusCompra, record.situacao, record.status),
      observedAt: firstString(item.dataHomologacao, item.dataAdjudicacao, item.dataResultado, record.dataHomologacao, record.dataAdjudicacao, record.dataResultado, record.dataPublicacaoPncp) ?? new Date().toISOString(),
      sourceUrl: sourceUrlFor(sourceCode, record, item, externalId),
      raw: { record, item },
    }];
  });
}

function marketItemsFromRecord(record: Record<string, unknown>): Record<string, unknown>[] {
  for (const key of ['itens', 'items', 'ITENS', 'resultadoItens', 'resultadosItens', 'itensHomologados', 'itensAdjudicados']) {
    if (Array.isArray(record[key])) return record[key].filter(recordValue);
  }
  for (const key of ['resultado', 'resultados', 'homologacao', 'adjudicacao']) {
    const nested = recordValue(record[key]);
    if (nested) return marketItemsFromRecord(nested);
  }
  return [record];
}

function sourceUrlFor(sourceCode: SourceId, record: Record<string, unknown>, item: Record<string, unknown>, externalId: string): string {
  const direct = firstString(
    item.linkSistemaOrigem,
    item.sourceUrl,
    item.linkEdital,
    record.linkSistemaOrigem,
    record.urlSistemaOrigem,
    record.sourceUrl,
    record.linkEdital,
    record.urlEdital,
  );
  if (direct) return direct;
  if (sourceCode === 'BEC/SP') return `https://www.bec.sp.gov.br/bec_pregao_UI/OC/pregao_oc_pesquisa.aspx?OC=${encodeURIComponent(externalId)}`;
  return `https://pncp.gov.br/app/contratacoes/${encodeURIComponent(externalId)}`;
}

function normalizeDescription(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function firstString(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === 'string' && value.trim().length > 0);
}

function firstMarketNumber(...values: unknown[]): number | null {
  for (const value of values) {
    const parsed = parseMarketNumber(value);
    if (parsed !== null) return parsed;
  }
  return null;
}

function firstText(...values: unknown[]): string | undefined {
  for (const value of values) {
    const text = firstString(value);
    if (text) return text;
    const nested = recordValue(value);
    if (nested) {
      const nestedText = firstString(nested.razaoSocial, nested.nome, nested.nomeRazaoSocial, nested.name);
      if (nestedText) return nestedText;
    }
  }
  return undefined;
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : undefined;
}

export { parseMarketMoneyToCents };
export type { MarketObservationInput, MarketResultInput, MarketQuery, SourceId, SourcePage, SourceQuery };
export { BecSpClient } from './BecSpClient';
