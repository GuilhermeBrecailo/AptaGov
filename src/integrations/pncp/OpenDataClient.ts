import { CircuitBreaker } from '../../resilience/circuitBreaker';
import { isRetryableError, withRetry } from '../../resilience/retry';
import type { PncpPage } from './paginator';
import { PncpHttpError, type PublishedQuery } from './PncpClient';

export interface OpenDataClientOptions {
  baseUrl: string;
  timeoutMs: number;
  maxRetries: number;
  fetchFn?: typeof fetch;
  circuitBreaker?: CircuitBreaker;
}

export class OpenDataClient {
  readonly source = 'OPEN_DATA' as const;
  private readonly fetchFn: typeof fetch;
  private readonly circuitBreaker: CircuitBreaker;

  constructor(private readonly options: OpenDataClientOptions) {
    this.fetchFn = options.fetchFn ?? fetch;
    this.circuitBreaker = options.circuitBreaker ?? new CircuitBreaker();
  }

  async fetchPublishedPage(query: PublishedQuery, page: number): Promise<PncpPage<Record<string, unknown>>> {
    return this.circuitBreaker.execute(() => withRetry(
      () => this.requestPage(query, page),
      {
        maxRetries: this.options.maxRetries,
        shouldRetry: isRetryableError,
      },
    ));
  }

  private async requestPage(query: PublishedQuery, page: number): Promise<PncpPage<Record<string, unknown>>> {
    const url = new URL(`${this.options.baseUrl.replace(/\/$/, '')}/modulo-contratacoes/1_consultarContratacoes_PNCP_14133`);
    url.searchParams.set('pagina', String(page));
    url.searchParams.set('tamanhoPagina', '50');
    url.searchParams.set('dataPublicacaoPncpInicial', query.dateFrom);
    url.searchParams.set('dataPublicacaoPncpFinal', query.dateTo);
    if (query.modality) url.searchParams.set('codigoModalidade', query.modality);
    if (query.state) url.searchParams.set('unidadeOrgaoUfSigla', query.state);
    if (query.cityIbge) url.searchParams.set('unidadeOrgaoCodigoIbge', query.cityIbge);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs);
    try {
      const response = await this.fetchFn(url, { headers: { accept: '*/*' }, signal: controller.signal });
      if (!response.ok) {
        throw new PncpHttpError(response.status, `Dados Abertos returned HTTP ${response.status}`);
      }
      if (response.status === 204) {
        return { data: [], numeroPagina: page, empty: true };
      }
      const body = await response.json() as unknown;
      if (Array.isArray(body)) return { data: body.map(normalizeOpenDataRecord), numeroPagina: page };
      const object = objectValue(body) ?? {};
      const rawData = Array.isArray(object.resultado)
        ? object.resultado
        : Array.isArray(object.data) ? object.data : [];
      const data = rawData.map(normalizeOpenDataRecord);
      return {
        data,
        totalPaginas: numberOrUndefined(object.totalPaginas),
        numeroPagina: page,
        paginasRestantes: numberOrUndefined(object.paginasRestantes),
        empty: data.length === 0,
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}

function normalizeOpenDataRecord(record: unknown): Record<string, unknown> {
  const input = objectValue(record) ?? {};
  const organization = objectValue(input.orgaoEntidade) ?? {
    cnpj: input.orgaoEntidadeCnpj,
    razaoSocial: input.orgaoEntidadeRazaoSocial,
  };
  const unit = objectValue(input.unidadeOrgao) ?? {
    codigoUnidade: input.unidadeOrgaoCodigoUnidade,
    nomeUnidade: input.unidadeOrgaoNomeUnidade,
    ufSigla: input.unidadeOrgaoUfSigla,
    municipioNome: input.unidadeOrgaoMunicipioNome,
    codigoIbge: input.unidadeOrgaoCodigoIbge,
  };
  return {
    ...input,
    numeroControlePNCP: firstString(input.numeroControlePNCP, input.numeroControlePncp, input.idCompra),
    anoCompra: firstNumber(input.anoCompra, input.anoCompraPncp),
    sequencialCompra: firstNumber(input.sequencialCompra, input.sequencialCompraPncp),
    orgaoEntidade: organization,
    unidadeOrgao: unit,
    modalidadeNome: firstString(input.modalidadeNome, input.nomeModalidadeCompra),
    informacaoComplementar: firstString(input.informacaoComplementar, input.informacoesComplementares),
    objetoCompra: firstString(input.objetoCompra, input.objeto),
    dataPublicacaoPncp: firstString(input.dataPublicacaoPncp, input.dataPublicacao),
    dataAberturaProposta: firstString(input.dataAberturaProposta, input.dataAberturaPropostaPncp),
    dataEncerramentoProposta: firstString(input.dataEncerramentoProposta, input.dataEncerramentoPropostaPncp),
  };
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : undefined;
}

function firstString(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === 'string' && value.trim().length > 0);
}

function firstNumber(...values: unknown[]): number | undefined {
  return values.find((value): value is number => typeof value === 'number');
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}
