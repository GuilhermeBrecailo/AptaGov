import type { FilterConfig } from '../domain/types';
import type { SourceId, MarketQuery } from '../domain/sourceTypes';
import { syncSourceMarket, type PagedOfficialSourceClient } from '../integrations/sources/OfficialSourceClient';
import { CircuitBreaker } from '../resilience/circuitBreaker';
import type { SourceSyncRepository } from '../repositories/sourceSyncRepository';
import { classifySourceError, type SourceErrorCategory } from './sourceSyncService';

export interface MarketRefreshServiceOptions {
  clients: readonly PagedOfficialSourceClient[];
  repository: SourceSyncRepository;
  circuitBreakers?: ReadonlyMap<SourceId, CircuitBreaker>;
}

export interface MarketRefreshRunInput {
  filters: FilterConfig;
  today?: Date;
  lookbackDays?: number;
  organizationId?: number;
  radarId?: number | null;
  scopeKey?: string;
  skipSources?: ReadonlySet<SourceId>;
}

export interface MarketRefreshSourceResult {
  source: SourceId;
  status: 'COMPLETED' | 'FAILED';
  received: number;
  persisted: number;
  created: number;
  updated: number;
  observationsReceived: number;
  resultsReceived: number;
  errorCategory?: SourceErrorCategory;
  error?: unknown;
}

export interface MarketRefreshResult {
  sourceResults: MarketRefreshSourceResult[];
  received: number;
  persisted: number;
  created: number;
  updated: number;
  observationsReceived: number;
  resultsReceived: number;
}

export class MarketRefreshService {
  private readonly breakers = new Map<SourceId, CircuitBreaker>();

  constructor(private readonly options: MarketRefreshServiceOptions) {
    for (const client of options.clients) {
      this.breakers.set(client.id, options.circuitBreakers?.get(client.id) ?? new CircuitBreaker());
    }
  }

  async run(input: MarketRefreshRunInput): Promise<MarketRefreshResult> {
    const query = buildQuery(input);
    const clients = this.options.clients.filter((client) => !input.skipSources?.has(client.id));
    const sourceResults = await Promise.all(clients.map((client) => this.runSource(client, query)));
    if (sourceResults.length > 0 && sourceResults.every((result) => result.status === 'FAILED')) {
      const firstFailure = sourceResults[0]?.error;
      throw firstFailure instanceof Error ? firstFailure : new Error('Nenhuma fonte de mercado disponivel');
    }
    return {
      sourceResults,
      received: sum(sourceResults, 'received'),
      persisted: sum(sourceResults, 'persisted'),
      created: sum(sourceResults, 'created'),
      updated: sum(sourceResults, 'updated'),
      observationsReceived: sum(sourceResults, 'observationsReceived'),
      resultsReceived: sum(sourceResults, 'resultsReceived'),
    };
  }

  async healthCheck(filters: FilterConfig, today = new Date(), source?: SourceId): Promise<boolean> {
    const clients = source ? this.options.clients.filter((client) => client.id === source) : this.options.clients;
    if (clients.length === 0) return false;
    const query = buildQuery({ filters, today, scopeKey: 'health-check' });
    const checks = await Promise.all(clients.map(async (client) => {
      try {
        await this.breakers.get(client.id)!.execute(async () => {
          const iterator = client.listMarketPages({ ...query, cursor: null })[Symbol.asyncIterator]();
          await iterator.next();
        });
        return true;
      } catch {
        return false;
      }
    }));
    return checks.every(Boolean);
  }

  private async runSource(client: PagedOfficialSourceClient, query: MarketQuery): Promise<MarketRefreshSourceResult> {
    try {
      const result = await this.breakers.get(client.id)!.execute(() => syncSourceMarket(client, query, this.options.repository));
      return {
        source: client.id,
        status: 'COMPLETED',
        received: result.received,
        persisted: result.persisted,
        created: result.created,
        updated: result.updated,
        observationsReceived: result.observationsReceived,
        resultsReceived: result.resultsReceived,
      };
    } catch (error) {
      const category = classifySourceError(error);
      this.options.repository.recordFailure(client.id, { dateFrom: query.dateFrom, dateTo: query.dateTo }, category, retryAt(category), 'market', query.scopeKey ?? 'default');
      return {
        source: client.id,
        status: 'FAILED',
        received: 0,
        persisted: 0,
        created: 0,
        updated: 0,
        observationsReceived: 0,
        resultsReceived: 0,
        errorCategory: category,
        error,
      };
    }
  }
}

function buildQuery(input: MarketRefreshRunInput): MarketQuery {
  const today = input.today ?? new Date();
  const lookbackDays = Math.max(1, Math.floor(input.lookbackDays ?? input.filters.lookbackDays));
  const dateTo = today.toISOString().slice(0, 10);
  const dateFromDate = new Date(today);
  dateFromDate.setUTCDate(dateFromDate.getUTCDate() - lookbackDays);
  return {
    dateFrom: dateFromDate.toISOString().slice(0, 10),
    dateTo,
    filters: input.filters,
    flow: 'market',
    scopeKey: input.scopeKey ?? 'default',
    organizationId: input.organizationId,
    radarId: input.radarId,
  };
}

function sum(results: MarketRefreshSourceResult[], key: keyof Pick<MarketRefreshSourceResult, 'received' | 'persisted' | 'created' | 'updated' | 'observationsReceived' | 'resultsReceived'>): number {
  return results.reduce((total, result) => total + result[key], 0);
}

function retryAt(category: SourceErrorCategory): string | null {
  if (category === 'UNAUTHORIZED_CONFIGURATION' || category === 'MALFORMED_RESPONSE') return null;
  return new Date(Date.now() + (category === 'RATE_LIMITED' || category === 'CIRCUIT_OPEN' ? 60_000 : 30_000)).toISOString();
}
