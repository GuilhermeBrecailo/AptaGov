import type { FilterConfig } from '../domain/types';
import type { SourceId, SourceQuery, SourceWindow } from '../domain/sourceTypes';
import {
  syncSourceOpportunities,
  type PagedOfficialSourceClient,
  type SourceSyncResult,
} from '../integrations/sources/OfficialSourceClient';
import { CircuitBreaker } from '../resilience/circuitBreaker';
import type { SourceSyncRepository } from '../repositories/sourceSyncRepository';
import type { SyncEntry } from './syncService';
import { normalizeOpportunitySnapshot } from './opportunityChangeService';

export type SourceErrorCategory =
  | 'RETRYABLE'
  | 'RATE_LIMITED'
  | 'UNAUTHORIZED_CONFIGURATION'
  | 'MALFORMED_RESPONSE'
  | 'UNAVAILABLE'
  | 'CIRCUIT_OPEN';

export interface SourceSyncServiceOptions {
  clients: readonly PagedOfficialSourceClient[];
  repository: SourceSyncRepository;
  circuitBreakers?: ReadonlyMap<SourceId, CircuitBreaker>;
  circuitFailureThreshold?: number;
  circuitResetTimeoutMs?: number;
}

export interface SourceSyncRunInput {
  filters: FilterConfig;
  today?: Date;
  organizationId?: number;
  radarId?: number | null;
  scopeKey?: string;
  onEntry?: (entry: SyncEntry) => void | Promise<void>;
  skipSources?: ReadonlySet<SourceId>;
}

export interface SourceSyncSourceResult {
  source: SourceId;
  status: 'COMPLETED' | 'FAILED';
  received: number;
  persisted: number;
  created: number;
  updated: number;
  entries: SyncEntry[];
  errorCategory?: SourceErrorCategory;
  error?: unknown;
  nextRetryAt?: string | null;
}

export interface SourceSyncRunResult {
  sourceResults: SourceSyncSourceResult[];
  received: number;
  persisted: number;
  created: number;
  updated: number;
  entries: SyncEntry[];
}

export class SourceSyncService {
  private readonly breakers = new Map<SourceId, CircuitBreaker>();

  constructor(private readonly options: SourceSyncServiceOptions) {
    for (const client of options.clients) {
      const supplied = options.circuitBreakers?.get(client.id);
      this.breakers.set(client.id, supplied ?? new CircuitBreaker(
        options.circuitFailureThreshold ?? 3,
        options.circuitResetTimeoutMs ?? 30_000,
      ));
    }
  }

  async run(input: SourceSyncRunInput): Promise<SourceSyncRunResult> {
    const queries = buildQueries(input.filters, input.today ?? new Date(), input.scopeKey ?? 'default', input.organizationId, input.radarId);
    const clients = this.options.clients.filter((client) => !input.skipSources?.has(client.id));
    const sourceResults = await Promise.all(clients.map((client) => this.runSource(client, queries, input.onEntry)));
    const entries = sourceResults.flatMap((result) => result.entries);
    const completed = sourceResults.filter((result) => result.status === 'COMPLETED');
    if (completed.length === 0 && sourceResults.length > 0) {
      const firstFailure = sourceResults[0]?.error;
      throw firstFailure instanceof Error ? firstFailure : new Error('Nenhuma fonte oficial disponivel');
    }
    return {
      sourceResults,
      received: sourceResults.reduce((sum, result) => sum + result.received, 0),
      persisted: sourceResults.reduce((sum, result) => sum + result.persisted, 0),
      created: sourceResults.reduce((sum, result) => sum + result.created, 0),
      updated: sourceResults.reduce((sum, result) => sum + result.updated, 0),
      entries,
    };
  }

  async healthCheck(filters: FilterConfig, today = new Date(), source?: SourceId): Promise<boolean> {
    const query = buildQueries(filters, today, 'health-check')[0];
    if (!query) return false;
    const clients = source ? this.options.clients.filter((client) => client.id === source) : this.options.clients;
    const checks = await Promise.all(clients.map(async (client) => {
      try {
        await this.breaker(client.id).execute(() => client.listOpportunities({ ...query, cursor: null }));
        return true;
      } catch {
        return false;
      }
    }));
    return clients.length > 0 && checks.every(Boolean);
  }

  private async runSource(
    client: PagedOfficialSourceClient,
    queries: SourceQuery[],
    onEntry: SourceSyncRunInput['onEntry'],
  ): Promise<SourceSyncSourceResult> {
    const total: SourceSyncSourceResult = {
      source: client.id,
      status: 'COMPLETED',
      received: 0,
      persisted: 0,
      created: 0,
      updated: 0,
      entries: [],
    };
    try {
      await this.breaker(client.id).execute(async () => {
        for (const query of queries) {
          const result = await syncSourceOpportunities(client, query, this.options.repository, {
            onEntry: async (entry) => {
              const normalized: SyncEntry = {
                previous: entry.previous ? normalizeOpportunitySnapshot(entry.previous) : undefined,
                current: normalizeOpportunitySnapshot(entry.current),
              };
              total.entries.push(normalized);
              await onEntry?.(normalized);
            },
          });
          addResult(total, result);
        }
      });
      return total;
    } catch (error) {
      const errorCategory = classifySourceError(error);
      const firstQuery = queries[0];
      if (firstQuery) {
        this.options.repository.recordFailure(
          client.id,
          windowOf(firstQuery),
          errorCategory,
          retryAt(errorCategory),
        );
      }
      return {
        ...total,
        status: 'FAILED',
        errorCategory,
        error,
        nextRetryAt: retryAt(errorCategory),
      };
    }
  }

  private breaker(source: SourceId): CircuitBreaker {
    return this.breakers.get(source) as CircuitBreaker;
  }
}

export function classifySourceError(error: unknown): SourceErrorCategory {
  if (error instanceof Error && /circuit breaker is open/i.test(error.message)) return 'CIRCUIT_OPEN';
  if (error instanceof SyntaxError || (error instanceof Error && /malformed|unexpected json|protocol/i.test(`${error.name} ${error.message}`))) {
    return 'MALFORMED_RESPONSE';
  }
  const status = statusOf(error);
  if (status === 401 || status === 403 || (status >= 400 && status < 500 && status !== 408 && status !== 425 && status !== 429)) {
    return 'UNAUTHORIZED_CONFIGURATION';
  }
  if (status === 429) return 'RATE_LIMITED';
  if (status === 408 || status === 425 || status >= 500) return status >= 500 ? 'UNAVAILABLE' : 'RETRYABLE';
  if (error instanceof Error && (error.name === 'AbortError' || error instanceof TypeError)) return 'RETRYABLE';
  return 'UNAVAILABLE';
}

function addResult(target: SourceSyncSourceResult, result: SourceSyncResult): void {
  target.received += result.received;
  target.persisted += result.persisted;
  target.created += result.created;
  target.updated += result.updated;
}

function buildQueries(filters: FilterConfig, today: Date, baseScopeKey = 'default', organizationId?: number, radarId?: number | null): SourceQuery[] {
  const dateTo = formatDate(today);
  const startDate = new Date(today);
  startDate.setUTCDate(startDate.getUTCDate() - filters.lookbackDays);
  const dateFrom = formatDate(startDate);
  const states = filters.states.length > 0 ? filters.states : [undefined];
  const cities = filters.citiesIbge.length > 0 ? filters.citiesIbge : [undefined];
  const modalities = filters.modalities.length > 0 ? filters.modalities : [undefined];
  const singleQuery = states.length === 1 && cities.length === 1 && modalities.length === 1;
  return states.flatMap((state) => cities.flatMap((cityIbge) => modalities.map((modality) => ({
    dateFrom,
    dateTo,
    filters: {
      ...filters,
      states: state ? [state] : [],
      citiesIbge: cityIbge ? [cityIbge] : [],
      modalities: modality ? [modality] : [],
    },
    flow: 'opportunity' as const,
    scopeKey: singleQuery ? baseScopeKey : `${baseScopeKey}:${state ?? '-'}:${cityIbge ?? '-'}:${modality ?? '-'}`,
    organizationId,
    radarId,
  }))));
}

function windowOf(query: SourceQuery): SourceWindow {
  return { dateFrom: query.dateFrom, dateTo: query.dateTo };
}

function retryAt(category: SourceErrorCategory): string | null {
  if (category === 'UNAUTHORIZED_CONFIGURATION' || category === 'MALFORMED_RESPONSE') return null;
  const delay = category === 'RATE_LIMITED' ? 60_000 : category === 'CIRCUIT_OPEN' ? 60_000 : 30_000;
  return new Date(Date.now() + delay).toISOString();
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function statusOf(error: unknown): number {
  if (typeof error !== 'object' || error === null || !('status' in error)) return 0;
  const status = Number((error as { status: unknown }).status);
  return Number.isFinite(status) ? status : 0;
}
