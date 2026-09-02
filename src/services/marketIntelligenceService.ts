import type { SourceId } from '../domain/sourceTypes';
import { sourceLabel } from '../domain/sourceTypes';
import { MarketRepository, type MarketRecord, type MarketRepositoryQuery } from '../repositories/marketRepository';

export type MarketDataState = 'READY' | 'INSUFFICIENT_DATA';

export type MarketSummaryQuery = MarketRepositoryQuery;

export interface MarketBreakdown {
  label: string;
  count: number;
}

export interface MarketSourceLink {
  sourceCode: SourceId;
  sourceLabel: string;
  url: string;
  externalId: string;
  observedAt: string;
  recordType: 'OBSERVATION' | 'RESULT';
}

export interface MonthlyMarketSeries {
  month: string;
  count: number;
  medianPriceCents: number | null;
}

export interface MarketSummary {
  state: MarketDataState;
  message: string | null;
  minimumObservations: number;
  observationCount: number;
  count: number;
  minPriceCents: number | null;
  medianPriceCents: number | null;
  maxPriceCents: number | null;
  min: number | null;
  median: number | null;
  max: number | null;
  monthlySeries: MonthlyMarketSeries[];
  purchaseCount: number;
  topOrganizations: MarketBreakdown[];
  topRegions: MarketBreakdown[];
  modalityBreakdown: MarketBreakdown[];
  statusBreakdown: MarketBreakdown[];
  lastUpdatedAt: string | null;
  lastUpdate: string | null;
  sourceLinks: MarketSourceLink[];
  auditLinks: MarketSourceLink[];
}

export interface MarketIntelligenceOptions {
  minimumObservations?: number;
  lookbackDays?: number;
}

export interface MarketIdentity {
  itemCode: string | null;
  normalizedDescription: string | null;
  unit: string | null;
}

const DEFAULT_MINIMUM_OBSERVATIONS = 5;
const DEFAULT_LOOKBACK_DAYS = 365;

export class MarketIntelligenceService {
  private readonly minimumObservations: number;
  private readonly lookbackDays: number;

  constructor(
    private readonly repository: Pick<MarketRepository, 'list'>,
    options: MarketIntelligenceOptions = {},
  ) {
    this.minimumObservations = Math.max(1, Math.floor(options.minimumObservations ?? DEFAULT_MINIMUM_OBSERVATIONS));
    this.lookbackDays = Math.max(1, Math.floor(options.lookbackDays ?? DEFAULT_LOOKBACK_DAYS));
  }

  getMarketSummary(query: MarketSummaryQuery = {}): MarketSummary {
    const range = resolveRange(query, this.lookbackDays);
    const records = deduplicate(this.repository.list({ ...query, ...range }));
    const compatibleRecords = selectCompatibleRecords(records, query);
    const pricedRecords = compatibleRecords.filter(hasUnitPrice);
    const enoughData = pricedRecords.length >= this.minimumObservations;
    const minPriceCents = enoughData ? Math.min(...pricedRecords.map((record) => record.unitPriceCents!)) : null;
    const medianPriceCents = enoughData ? median(pricedRecords.map((record) => record.unitPriceCents!)) : null;
    const maxPriceCents = enoughData ? Math.max(...pricedRecords.map((record) => record.unitPriceCents!)) : null;
    const monthlySeries = monthlySummary(pricedRecords, range.dateFrom, range.dateTo);
    const sourceLinks = linksFor(compatibleRecords);
    const message = enoughData ? null : 'Dados insuficientes para uma referência segura neste recorte.';

    return {
      state: enoughData ? 'READY' : 'INSUFFICIENT_DATA',
      message,
      minimumObservations: this.minimumObservations,
      observationCount: pricedRecords.length,
      count: pricedRecords.length,
      minPriceCents,
      medianPriceCents,
      maxPriceCents,
      min: minPriceCents,
      median: medianPriceCents,
      max: maxPriceCents,
      monthlySeries,
      purchaseCount: new Set(compatibleRecords.map(purchaseKey)).size,
      topOrganizations: breakdown(compatibleRecords.map((record) => record.organization || 'Não informado')),
      topRegions: breakdown(compatibleRecords.map((record) => record.state || 'Não informado')),
      modalityBreakdown: breakdown(compatibleRecords.map((record) => record.modality || 'Não informada')),
      statusBreakdown: breakdown(compatibleRecords.map((record) => record.status || 'Não informado')),
      lastUpdatedAt: latest(compatibleRecords.map((record) => record.observedAt)),
      lastUpdate: latest(compatibleRecords.map((record) => record.observedAt)),
      sourceLinks,
      auditLinks: sourceLinks,
    };
  }
}

export function extractMarketIdentity(opportunity: {
  title: string;
  description: string;
  raw?: unknown;
}): MarketIdentity {
  const raw = recordValue(opportunity.raw);
  const item = recordValue(raw?.item) ?? recordValue(raw?.ITEM) ?? raw;
  const itemCode = firstString(
    item?.CD_ITEM,
    item?.codigoItem,
    item?.Codigo,
    item?.codigo,
    raw?.codigoItem,
    raw?.codItemCatalogo,
    raw?.itemCode,
  );
  const description = firstString(
    item?.DESCRICAO_ITEM,
    item?.descricaoItem,
    item?.Descricao,
    raw?.descricaoItem,
    raw?.objetoCompra,
    raw?.objeto,
  ) ?? (itemCode ? firstString(opportunity.description, opportunity.title) : undefined);
  const unit = firstString(
    item?.UNIDADE_FORNECIMENTO,
    item?.unidadeFornecimento,
    item?.unidade,
    item?.unit,
    raw?.unidadeFornecimento,
    raw?.unidade,
    raw?.unit,
  );
  return {
    itemCode: itemCode?.trim() || null,
    normalizedDescription: description ? normalizeDescription(description) : null,
    unit: unit?.trim().toUpperCase() || null,
  };
}

export function normalizeDescription(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle]! : Math.round((sorted[middle - 1]! + sorted[middle]!) / 2);
}

function resolveRange(query: MarketSummaryQuery, lookbackDays: number): { dateFrom: string; dateTo: string } {
  const dateTo = query.dateTo ?? new Date().toISOString();
  const dateFrom = query.dateFrom ?? new Date(new Date(dateTo).getTime() - lookbackDays * 24 * 60 * 60 * 1_000).toISOString();
  return { dateFrom, dateTo };
}

function selectCompatibleRecords(records: MarketRecord[], query: MarketSummaryQuery): MarketRecord[] {
  const hasIdentity = Boolean(query.itemCode?.trim() && query.normalizedDescription?.trim() && query.unit?.trim());
  if (hasIdentity) return records;
  const groups = new Map<string, MarketRecord[]>();
  for (const record of records) {
    const key = compatibilityKey(record);
    const group = groups.get(key) ?? [];
    group.push(record);
    groups.set(key, group);
  }
  if (groups.size !== 1) return [];
  return [...groups.values()][0] ?? [];
}

function compatibilityKey(record: Pick<MarketRecord, 'itemCode' | 'normalizedDescription' | 'unit'>): string {
  return `${record.itemCode.trim().toUpperCase()}|${normalizeDescription(record.normalizedDescription)}|${record.unit.trim().toUpperCase()}`;
}

function deduplicate(records: MarketRecord[]): MarketRecord[] {
  const unique = new Map<string, MarketRecord>();
  for (const record of records) {
    const key = `${record.sourceCode}|${record.externalId}|${record.itemCode}`;
    const previous = unique.get(key);
    if (!previous || recordRank(record) > recordRank(previous)) unique.set(key, record);
  }
  return [...unique.values()].sort((left, right) => right.observedAt.localeCompare(left.observedAt) || right.id - left.id);
}

function recordRank(record: MarketRecord): number {
  return (record.unitPriceCents === null ? 0 : 10)
    + (record.recordType === 'RESULT' ? 2 : 0)
    + (record.status ? 1 : 0)
    + (record.sourceUrl ? 1 : 0);
}

function hasUnitPrice(record: MarketRecord): boolean {
  return Number.isSafeInteger(record.unitPriceCents) && (record.unitPriceCents ?? -1) >= 0;
}

function monthlySummary(records: MarketRecord[], dateFrom: string, dateTo: string): MonthlyMarketSeries[] {
  const start = monthStart(new Date(dateFrom));
  const end = monthStart(new Date(dateTo));
  const output: MonthlyMarketSeries[] = [];
  for (const cursor = new Date(start); cursor <= end; cursor.setUTCMonth(cursor.getUTCMonth() + 1)) {
    const month = monthKey(cursor);
    const prices = records.filter((record) => monthKey(new Date(record.observedAt)) === month).map((record) => record.unitPriceCents!);
    output.push({ month, count: prices.length, medianPriceCents: median(prices) });
  }
  return output;
}

function breakdown(values: string[]): MarketBreakdown[] {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label));
}

function linksFor(records: MarketRecord[]): MarketSourceLink[] {
  const links = new Map<string, MarketSourceLink>();
  for (const record of records) {
    if (!record.sourceUrl) continue;
    const key = `${record.sourceCode}|${record.externalId}|${record.sourceUrl}`;
    links.set(key, {
      sourceCode: record.sourceCode,
      sourceLabel: sourceLabel(record.sourceCode),
      url: record.sourceUrl,
      externalId: record.externalId,
      observedAt: record.observedAt,
      recordType: record.recordType,
    });
  }
  return [...links.values()];
}

function purchaseKey(record: MarketRecord): string {
  return `${record.sourceCode}|${record.externalId}|${record.itemCode}`;
}

function latest(values: string[]): string | null {
  return values.reduce<string | null>((current, value) => !current || value > current ? value : current, null);
}

function monthStart(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), 1));
}

function monthKey(value: Date): string {
  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, '0')}`;
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : undefined;
}

function firstString(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === 'string' && value.trim().length > 0);
}
