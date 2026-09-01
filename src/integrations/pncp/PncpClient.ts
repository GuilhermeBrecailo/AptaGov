import { CircuitBreaker } from '../../resilience/circuitBreaker';
import { isRetryableError, withRetry } from '../../resilience/retry';
import { paginateAll, type PncpPage } from './paginator';

export interface PublishedQuery {
  dateFrom: string;
  dateTo: string;
  state?: string;
  cityIbge?: string;
  modality?: string;
}

export interface PncpClientOptions {
  baseUrl: string;
  timeoutMs: number;
  maxRetries: number;
  fetchFn?: typeof fetch;
  circuitBreaker?: CircuitBreaker;
}

export class PncpHttpError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = 'PncpHttpError';
  }
}

export class PncpClient {
  private readonly fetchFn: typeof fetch;
  private readonly circuitBreaker: CircuitBreaker;

  constructor(private readonly options: PncpClientOptions) {
    this.fetchFn = options.fetchFn ?? fetch;
    this.circuitBreaker = options.circuitBreaker ?? new CircuitBreaker();
  }

  async fetchPublishedPage(query: PublishedQuery, page: number): Promise<PncpPage<Record<string, unknown>>> {
    return this.circuitBreaker.execute(() => withRetry(
      (attempt) => this.requestPage(query, page, attempt),
      {
        maxRetries: this.options.maxRetries,
        shouldRetry: isRetryableError,
      },
    ));
  }

  async fetchAllPublished(query: PublishedQuery): Promise<Record<string, unknown>[]> {
    return paginateAll((page) => this.fetchPublishedPage(query, page));
  }

  private async requestPage(query: PublishedQuery, page: number, _attempt: number): Promise<PncpPage<Record<string, unknown>>> {
    const url = new URL(`${this.options.baseUrl.replace(/\/$/, '')}/contratacoes/publicacao`);
    url.searchParams.set('dataInicial', query.dateFrom.replace(/-/g, ''));
    url.searchParams.set('dataFinal', query.dateTo.replace(/-/g, ''));
    url.searchParams.set('pagina', String(page));
    url.searchParams.set('tamanhoPagina', '50');
    if (query.state) url.searchParams.set('uf', query.state);
    if (query.cityIbge) url.searchParams.set('codigoMunicipioIbge', query.cityIbge);
    if (query.modality) url.searchParams.set('codigoModalidadeContratacao', query.modality);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs);
    try {
      const response = await this.fetchFn(url, { headers: { accept: '*/*' }, signal: controller.signal });
      if (!response.ok) {
        throw new PncpHttpError(response.status, `PNCP returned HTTP ${response.status}`);
      }
      if (response.status === 204) {
        return { data: [], numeroPagina: page, empty: true };
      }
      const body = await response.json() as unknown;
      if (Array.isArray(body)) return { data: body as Record<string, unknown>[], numeroPagina: page };
      const object = body as Record<string, unknown>;
      const data = Array.isArray(object.data) ? object.data as Record<string, unknown>[] : [];
      return {
        data,
        totalPaginas: numberOrUndefined(object.totalPaginas),
        numeroPagina: numberOrUndefined(object.numeroPagina) ?? page,
        paginasRestantes: numberOrUndefined(object.paginasRestantes),
        empty: object.empty === true,
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}
