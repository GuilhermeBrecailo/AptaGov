import { isRetryableError, withRetry } from '../../resilience/retry';
import type {
  MarketObservationInput,
  MarketResultInput,
  MarketQuery,
  SourcePage,
  SourceQuery,
} from '../../domain/sourceTypes';
import type { OpportunityInput } from '../../domain/types';
import type { MarketSourcePage, PagedOfficialSourceClient } from './OfficialSourceClient';
import { parseMarketMoneyToCents, parseMarketNumber } from './marketValues';

export type BecSpOperation =
  | 'convite'
  | 'dispensa'
  | 'pregaoM'
  | 'pregaoS'
  | 'pregaoRP'
  | 'convite_encerrado'
  | 'dispensa_encerrado'
  | 'pregao_encerrado';

export interface BecSpClientOptions {
  baseUrl?: string;
  operation?: BecSpOperation;
  operations?: BecSpOperation[];
  timeoutMs: number;
  maxRetries: number;
  fetchFn?: typeof fetch;
}

export class BecSpHttpError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = 'BecSpHttpError';
  }
}

export class BecSpProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BecSpProtocolError';
  }
}

export class BecSpClient implements PagedOfficialSourceClient {
  readonly id = 'BEC/SP' as const;
  private readonly fetchFn: typeof fetch;
  private readonly operations: BecSpOperation[];

  constructor(private readonly options: BecSpClientOptions) {
    this.fetchFn = options.fetchFn ?? fetch;
    this.operations = options.operations ?? [options.operation ?? 'pregao_encerrado'];
  }

  async listOpportunities(query: SourceQuery): Promise<SourcePage<OpportunityInput>> {
    const records = await this.loadRecords(query);
    return {
      items: records.flatMap((record) => opportunityFromRecord(record, query)),
      nextCursor: null,
      hasNext: false,
      fetchedAt: new Date().toISOString(),
    };
  }

  async *listOpportunityPages(query: SourceQuery): AsyncGenerator<SourcePage<OpportunityInput>> {
    yield this.mapOpportunityPage(await this.loadRecords(query), query);
  }

  async listMarketObservations(query: MarketQuery): Promise<SourcePage<MarketObservationInput>> {
    const records = await this.loadRecords(query);
    return {
      items: records.flatMap((record) => marketObservationsFromRecord(record, query)),
      nextCursor: null,
      hasNext: false,
      fetchedAt: new Date().toISOString(),
    };
  }

  async listMarketResults(query: MarketQuery): Promise<SourcePage<MarketResultInput>> {
    const records = await this.loadRecords(query);
    return {
      items: records.flatMap((record) => marketResultsFromRecord(record, query)),
      nextCursor: null,
      hasNext: false,
      fetchedAt: new Date().toISOString(),
    };
  }

  async *listMarketPages(query: MarketQuery): AsyncGenerator<MarketSourcePage> {
    yield this.mapMarketPage(await this.loadRecords(query), query);
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

  private mapOpportunityPage(records: Record<string, unknown>[], query: SourceQuery): SourcePage<OpportunityInput> {
    return {
      items: records.flatMap((record) => opportunityFromRecord(record, query)),
      nextCursor: null,
      hasNext: false,
      fetchedAt: new Date().toISOString(),
    };
  }

  private mapMarketPage(records: Record<string, unknown>[], query: MarketQuery): MarketSourcePage {
    return {
      items: records.flatMap((record) => marketObservationsFromRecord(record, query)),
      results: records.flatMap((record) => marketResultsFromRecord(record, query)),
      nextCursor: null,
      hasNext: false,
      fetchedAt: new Date().toISOString(),
    };
  }

  private async loadRecords(query: SourceQuery): Promise<Record<string, unknown>[]> {
    const records: Record<string, unknown>[] = [];
    for (const operation of this.operations) {
      const firstLevelPath = operationPath(operation, query);
      const firstLevel = await this.requestJson(firstLevelPath);
      records.push(...await this.expandRecords(firstLevel, operation, query));
    }
    return records;
  }

  private async expandRecords(
    records: Record<string, unknown>[],
    operation: BecSpOperation,
    query: SourceQuery,
  ): Promise<Record<string, unknown>[]> {
    const expanded: Record<string, unknown>[] = [];
    for (const record of records) {
      const offerId = firstString(record.OC, record.oc, record.NumeroOC, record.numeroOC);
      if (operation.endsWith('_encerrado') && offerId) {
        const operationRoot = operationRootPath(operation, query);
        const detail = await this.requestJson(`${operationRoot}${encodeURIComponent(offerId)}`);
        expanded.push({ ...record, ...(detail[0] ?? {}) });
        continue;
      }

      const code = firstString(record.Codigo, record.codigo);
      if (!code || offerId) {
        expanded.push(record);
        continue;
      }

      const operationRoot = operationRootPath(operation, query);
      const offers = await this.requestJson(`${operationRoot}${encodeURIComponent(code)}`);
      for (const offer of offers) {
        const offerId = firstString(offer.OC, offer.oc);
        if (!offerId) {
          expanded.push(offer);
          continue;
        }
        const detail = await this.requestJson(`${operationRoot}${encodeURIComponent(code)}/${encodeURIComponent(offerId)}`);
        expanded.push({ ...offer, ...(detail[0] ?? {}) });
      }
    }
    return expanded;
  }

  private requestJson(path: string): Promise<Record<string, unknown>[]> {
    return withRetry(
      (attempt) => this.requestJsonOnce(path, attempt),
      { maxRetries: this.options.maxRetries, shouldRetry: isRetryableError },
    );
  }

  private async requestJsonOnce(path: string, _attempt: number): Promise<Record<string, unknown>[]> {
    const url = new URL(path, `${(this.options.baseUrl ?? 'https://www.bec.sp.gov.br').replace(/\/$/, '')}/`);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs);
    try {
      const response = await this.fetchFn(url, {
        headers: { accept: 'application/json' },
        signal: controller.signal,
      });
      if (!response.ok) throw new BecSpHttpError(response.status, `BEC/SP returned HTTP ${response.status}`);
      if (response.status === 204) return [];
      const contentType = response.headers.get('content-type') ?? '';
      if (contentType && !contentType.toLowerCase().includes('json')) {
        throw new BecSpProtocolError('BEC/SP returned a non-JSON response');
      }
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        throw new BecSpProtocolError('BEC/SP returned malformed JSON');
      }
      return recordsFromPayload(body);
    } finally {
      clearTimeout(timeout);
    }
  }
}

function operationPath(operation: BecSpOperation, query: SourceQuery): string {
  if (operation.endsWith('_encerrado')) {
    return `${operationRootPath(operation, query)}${formatBecDate(query.dateFrom)}/${formatBecDate(query.dateTo)}`;
  }
  return `${operationRootPath(operation, query)}`;
}

function operationRootPath(operation: BecSpOperation, _query: SourceQuery): string {
  if (operation.endsWith('_encerrado')) return `/BEC_API/API/${operation}/OC_encerrada/`;
  const operationName = operation === 'convite' ? 'Convite' : operation;
  return `/BEC_API/API/${operationName}/NegociacaoItemOC/`;
}

function recordsFromPayload(body: unknown): Record<string, unknown>[] {
  if (Array.isArray(body)) return body.filter(isRecord);
  if (!isRecord(body)) throw new BecSpProtocolError('BEC/SP returned an unexpected JSON envelope');
  for (const key of ['data', 'items', 'resultado', 'records']) {
    if (Array.isArray(body[key])) return body[key].filter(isRecord);
  }
  return [body];
}

function opportunityFromRecord(record: Record<string, unknown>, query: SourceQuery): OpportunityInput[] {
  const offerId = firstString(record.OC, record.oc, record.NumeroOC, record.numeroOC);
  if (!offerId) return [];
  const items = Array.isArray(record.ITENS) ? record.ITENS.filter(isRecord) : [record];
  return items.map((item) => {
    const itemCode = firstString(item.CD_ITEM, item.Codigo, item.codigo) ?? '';
    const title = firstString(item.DESCRICAO_ITEM, record.Objeto, record.objeto, record.PROCEDIMENTO) ?? `Oferta de compra ${offerId}`;
    return {
      pncpId: `BEC/SP:${offerId}:${itemCode}`,
      source: 'BEC/SP',
      sourceCode: 'BEC/SP',
      title,
      description: firstString(item.DESCRICAO_CLASSE, record.SITUACAO) ?? '',
      organization: firstString(record.UNIDADE_COMPRADORA, record.EnteFederativoComplemento, record.EnteFederativo) ?? '',
      state: firstString(record.UF) ?? 'SP',
      city: firstString(record.MUNICIPIO) ?? '',
      modality: firstString(record.MODALIDADE, record.PROCEDIMENTO) ?? '',
      sourceUrl: firstString(record.LINK_EDITAL) ?? `https://www.bec.sp.gov.br/bec_pregao_UI/OC/pregao_oc_pesquisa.aspx?OC=${encodeURIComponent(offerId)}`,
      publicationDate: parseBecDate(firstString(record.DT_INICIO), query.dateFrom),
      biddingDeadline: parseBecDate(firstString(record.DT_FIM), query.dateTo),
      estimatedValueCents: parseMarketMoneyToCents(
        item.VALOR_REFERENCIA,
        item.MenorValor,
        record.VALOR_REFERENCIA,
      ) ?? 0,
      raw: { record, item },
    };
  });
}

function marketObservationsFromRecord(record: Record<string, unknown>, query: MarketQuery): MarketObservationInput[] {
  const offerId = firstString(record.OC, record.oc, record.NumeroOC, record.numeroOC);
  if (!offerId) return [];
  const items = Array.isArray(record.ITENS) ? record.ITENS.filter(isRecord) : [record];
  return items.flatMap((item) => {
    const itemCode = firstString(item.CD_ITEM, item.Codigo, item.codigo);
    const description = firstString(item.DESCRICAO_ITEM, record.Objeto, record.objeto);
    if (!itemCode || !description) return [];
    const unit = firstString(item.UNIDADE_FORNECIMENTO, item.UNIDADE, item.unidade);
    const quantity = parseMarketNumber(item.QUANTIDADE ?? item.quantidade);
    if (!unit || quantity === null) return [];
    return [{
      sourceCode: 'BEC/SP' as const,
      externalId: offerId,
      itemCode,
      normalizedDescription: normalizeDescription(description),
      unit,
      quantity,
      unitPriceCents: parseMarketMoneyToCents(item.MenorValor, item.VALOR_UNITARIO),
      totalPriceCents: parseMarketMoneyToCents(item.VL_TOTAL_NEGOCIADO, item.VALOR_TOTAL),
      organization: firstString(record.UNIDADE_COMPRADORA, record.EnteFederativoComplemento) ?? '',
      state: firstString(record.UF) ?? 'SP',
      modality: firstString(record.MODALIDADE, record.PROCEDIMENTO),
      status: firstString(record.SITUACAO, record.STATUS),
      observedAt: parseBecDate(firstString(record.DT_FIM, record.DT_INICIO), query.dateTo),
      sourceUrl: firstString(record.LINK_EDITAL)
        ?? `https://www.bec.sp.gov.br/bec_pregao_UI/OC/pregao_oc_pesquisa.aspx?OC=${encodeURIComponent(offerId)}`,
      raw: { record, item },
    }];
  });
}

function marketResultsFromRecord(record: Record<string, unknown>, query: MarketQuery): MarketResultInput[] {
  const offerId = firstString(record.OC, record.oc, record.NumeroOC, record.numeroOC);
  if (!offerId) return [];
  const items = Array.isArray(record.ITENS) ? record.ITENS.filter(isRecord) : [record];
  return items.flatMap((item) => {
    const itemCode = firstString(item.CD_ITEM, item.Codigo, item.codigo);
    const description = firstString(item.DESCRICAO_ITEM, record.Objeto, record.objeto);
    const unit = firstString(item.UNIDADE_FORNECIMENTO, item.UNIDADE, item.unidade);
    const quantity = parseMarketNumber(item.QUANTIDADE ?? item.quantidade);
    if (!itemCode || !description || !unit || quantity === null) return [];
    return [{
      sourceCode: 'BEC/SP' as const,
      externalId: offerId,
      itemCode,
      normalizedDescription: normalizeDescription(description),
      unit,
      quantity,
      unitPriceCents: parseMarketMoneyToCents(item.VALOR_UNITARIO, item.MenorValor),
      totalPriceCents: parseMarketMoneyToCents(item.VALOR_TOTAL, item.VL_TOTAL_NEGOCIADO),
      organization: firstString(record.UNIDADE_COMPRADORA, record.EnteFederativoComplemento) ?? '',
      state: firstString(record.UF) ?? 'SP',
      opportunityId: null,
      winner: firstText(item.VENCEDOR, item.FORNECEDOR, item.NOME_FORNECEDOR, record.VENCEDOR, record.FORNECEDOR) ?? null,
      awardedPriceCents: parseMarketMoneyToCents(item.VALOR_TOTAL_HOMOLOGADO, item.VL_TOTAL_NEGOCIADO, item.VALOR_ADJUDICADO),
      modality: firstString(record.MODALIDADE, record.PROCEDIMENTO),
      status: firstString(record.SITUACAO, record.STATUS),
      observedAt: parseBecDate(firstString(record.DT_FIM, record.DT_INICIO), query.dateTo),
      sourceUrl: firstString(record.LINK_EDITAL)
        ?? `https://www.bec.sp.gov.br/bec_pregao_UI/OC/pregao_oc_pesquisa.aspx?OC=${encodeURIComponent(offerId)}`,
      raw: { record, item },
    }];
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function firstString(...values: unknown[]): string | undefined {
  return values.find((value): value is string | number => (typeof value === 'string' && value.trim().length > 0) || typeof value === 'number')?.toString();
}

function normalizeDescription(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function firstText(...values: unknown[]): string | undefined {
  for (const value of values) {
    const text = firstString(value);
    if (text) return text;
    if (isRecord(value)) {
      const nested = firstString(value.razaoSocial, value.nome, value.nomeRazaoSocial, value.name);
      if (nested) return nested;
    }
  }
  return undefined;
}

function formatBecDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return match ? `${match[3]}${match[2]}${match[1]}` : value.replace(/\D/g, '');
}

function parseBecDate(value: string | undefined, fallback: string): string {
  const candidate = value ?? fallback;
  const match = /^(\d{2})[/-](\d{2})[/-](\d{4})$/.exec(candidate);
  if (match) return `${match[3]}-${match[2]}-${match[1]}T00:00:00.000Z`;
  const parsed = new Date(candidate);
  return Number.isNaN(parsed.getTime()) ? `${fallback}T00:00:00.000Z` : parsed.toISOString();
}
