import { describe, expect, it } from 'vitest';
import type { FilterConfig, OpportunityInput } from '../../src/domain/types';
import {
  BecSpClient,
  OpenDataSourceClient,
  PncpSourceClient,
  parseMarketMoneyToCents,
  runSourcesIndependently,
} from '../../src/integrations/sources/OfficialSourceClient';
import { createDefaultSourceRegistry, createSourceRegistry, sourceRegistry } from '../../src/integrations/sources/sourceRegistry';
import { sourceLabel } from '../../src/domain/sourceTypes';
import { loadEnv } from '../../src/config/env';

const filters: FilterConfig = {
  lookbackDays: 3,
  states: ['SP'],
  citiesIbge: [],
  modalities: ['6'],
  keywords: ['software'],
  excludedKeywords: [],
  minimumScore: 0,
  estimatedValueMinCents: 0,
  scoreWeights: { keyword: 50, region: 20, value: 10, deadline: 20 },
};

const query = {
  dateFrom: '2026-08-28',
  dateTo: '2026-08-31',
  filters,
};

function opportunityRecord(id: string): Record<string, unknown> {
  return {
    numeroControlePNCP: id,
    objetoCompra: `Contratação ${id}`,
    dataPublicacaoPncp: '2026-08-31T10:00:00.000Z',
    dataEncerramentoProposta: '2026-09-10T10:00:00.000Z',
    orgaoEntidade: { razaoSocial: 'Órgão oficial' },
    unidadeOrgao: { ufSigla: 'SP', municipioNome: 'São Paulo' },
    valorTotalEstimado: 100,
  };
}

describe('contrato de fontes oficiais', () => {
  it('consome todas as páginas declaradas pelo PNCP, incluindo a última', async () => {
    const requestedPages: number[] = [];
    const client = new PncpSourceClient({
      sourceClient: {
        fetchPublishedPage: async (_query, page) => {
          requestedPages.push(page);
          return {
            data: [opportunityRecord(`pncp-${page}`)],
            totalPaginas: 3,
            numeroPagina: page,
          };
        },
      },
    });

    const page = await client.listOpportunities(query);

    expect(requestedPages).toEqual([1, 2, 3]);
    expect(page.items.map((item) => item.pncpId)).toEqual(['pncp-1', 'pncp-2', 'pncp-3']);
    expect(page.hasNext).toBe(false);
    expect(page.nextCursor).toBeNull();
  });

  it('mantém o adapter de Dados Abertos sobre o mesmo paginator e normaliza a origem', async () => {
    const requestedPages: number[] = [];
    const client = new OpenDataSourceClient({
      sourceClient: {
        fetchPublishedPage: async (_query, page) => {
          requestedPages.push(page);
          return {
            data: [opportunityRecord(`open-data-${page}`)],
            totalPaginas: 2,
            numeroPagina: page,
          };
        },
      },
    });

    const page = await client.listOpportunities(query);

    expect(requestedPages).toEqual([1, 2]);
    expect(page.items[0]).toMatchObject({ sourceCode: 'OPEN_DATA', source: 'OPEN_DATA' });
    expect(page.items).toHaveLength(2);
  });

  it('expõe resultados homologados e itens do payload oficial com vencedor, awarded e rastreabilidade', async () => {
    const client = new PncpSourceClient({
      sourceClient: {
        fetchPublishedPage: async () => ({
          data: [{
            numeroControlePNCP: 'pncp-result-1',
            objetoCompra: 'Serviço de suporte',
            modalidadeNome: 'Pregão eletrônico',
            situacaoCompra: 'HOMOLOGADO',
            dataResultado: '2026-08-31T10:00:00.000Z',
            linkSistemaOrigem: 'https://pncp.gov.br/resultado/pncp-result-1',
            orgaoEntidade: { razaoSocial: 'Órgão oficial' },
            unidadeOrgao: { ufSigla: 'SP', municipioNome: 'São Paulo' },
            itens: [{
              codigoItem: 'ITEM-1',
              descricaoItem: 'Serviço de suporte',
              unidadeFornecimento: 'UN',
              quantidade: 1,
              valorTotalHomologado: 125.5,
              valorHomologado: 125.5,
              nomeRazaoSocialFornecedor: 'Fornecedor vencedor',
            }],
            totalPaginas: 1,
          }],
          totalPaginas: 1,
          numeroPagina: 1,
        }),
      },
    });

    const page = await client.listMarketResults(query);

    expect(page.items).toMatchObject([{
      sourceCode: 'PNCP',
      externalId: 'pncp-result-1',
      itemCode: 'ITEM-1',
      normalizedDescription: 'servico de suporte',
      unit: 'UN',
      quantity: 1,
      unitPriceCents: null,
      totalPriceCents: 12_550,
      awardedPriceCents: 12_550,
      winner: 'Fornecedor vencedor',
      modality: 'Pregão eletrônico',
      status: 'HOMOLOGADO',
      sourceUrl: 'https://pncp.gov.br/resultado/pncp-result-1',
    }]);
  });

  it('não converte texto monetário vazio ou inválido em zero e aceita zero explícito', () => {
    expect(parseMarketMoneyToCents('')).toBeNull();
    expect(parseMarketMoneyToCents('não informado')).toBeNull();
    expect(parseMarketMoneyToCents('R$ 0,00')).toBe(0);
    expect(parseMarketMoneyToCents(0)).toBe(0);
  });

  it('expõe labels canônicas sem alterar os códigos persistidos', () => {
    expect(sourceLabel('PNCP')).toBe('PNCP');
    expect(sourceLabel('OPEN_DATA')).toBe('Dados Abertos');
    expect(sourceLabel('BEC/SP')).toBe('BEC/SP');
  });

  it('isola falha de uma fonte e preserva o resultado das fontes saudáveis', async () => {
    const healthy: { id: 'PNCP'; listOpportunities: (input: typeof query) => Promise<{ items: OpportunityInput[]; nextCursor: null; hasNext: false; fetchedAt: string }> } = {
      id: 'PNCP',
      listOpportunities: async () => ({
        items: [opportunityRecord('healthy') as unknown as OpportunityInput],
        nextCursor: null,
        hasNext: false,
        fetchedAt: '2026-08-31T12:00:00.000Z',
      }),
    };
    const failing = {
      id: 'BEC/SP' as const,
      listOpportunities: async () => { throw new Error('BEC/SP indisponível'); },
    };

    const results = await runSourcesIndependently([healthy, failing], (client) => client.listOpportunities(query));

    expect(results.find((result) => result.source === 'PNCP')?.page?.items).toHaveLength(1);
    expect(results.find((result) => result.source === 'BEC/SP')?.error).toBeInstanceOf(Error);
  });

  it('mapeia fixture oficial BEC/SP por HTTP JSON, com URL, timeout e retries configuráveis', async () => {
    const requestedUrls: URL[] = [];
    const summary = {
      OC: '100111000012026OC00015',
      UNIDADE_COMPRADORA: 'Órgão BEC',
      PROCEDIMENTO: 'Pregão Eletrônico',
      SITUACAO: 'Encerrada(o) com Vencedor',
    };
    const detail = {
      OC: '100111000012026OC00015',
      MUNICIPIO: 'São Paulo',
      UF: 'SP',
      DT_INICIO: '01/08/2026',
      DT_FIM: '31/08/2026',
      LINK_EDITAL: 'https://www.bec.sp.gov.br/edital/oc-15',
      ITENS: [{
        NR_SEQUENCIA_ITEM: '1',
        CD_ITEM: '12345',
        DESCRICAO_ITEM: 'Serviço de suporte',
        UNIDADE_FORNECIMENTO: 'UNIDADE',
        QUANTIDADE: '2',
        MenorValor: '10,50',
        VL_TOTAL_NEGOCIADO: '21,00',
        NOME_FORNECEDOR: 'Fornecedor BEC',
      }],
    };
    const client = new BecSpClient({
      baseUrl: 'https://bec.example.test',
      operation: 'pregao_encerrado',
      timeoutMs: 1_000,
      maxRetries: 0,
      fetchFn: async (input) => {
        const url = new URL(String(input));
        requestedUrls.push(url);
        const body = url.pathname.endsWith('/100111000012026OC00015') ? [detail] : [summary];
        return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
      },
    });

    const page = await client.listOpportunities(query);

    expect(requestedUrls.map((url) => url.pathname)).toEqual([
      '/BEC_API/API/pregao_encerrado/OC_encerrada/28082026/31082026',
      '/BEC_API/API/pregao_encerrado/OC_encerrada/100111000012026OC00015',
    ]);
    expect(page.items[0]).toMatchObject({
      pncpId: 'BEC/SP:100111000012026OC00015:12345',
      sourceCode: 'BEC/SP',
      sourceUrl: 'https://www.bec.sp.gov.br/edital/oc-15',
      state: 'SP',
      city: 'São Paulo',
      publicationDate: '2026-08-01T00:00:00.000Z',
      biddingDeadline: '2026-08-31T00:00:00.000Z',
      title: 'Serviço de suporte',
    });

    requestedUrls.length = 0;
    const market = await client.listMarketObservations(query);
    expect(requestedUrls).toHaveLength(2);
    expect(market.items[0]).toMatchObject({
      externalId: '100111000012026OC00015',
      itemCode: '12345',
      normalizedDescription: 'servico de suporte',
      unit: 'UNIDADE',
      quantity: 2,
      unitPriceCents: 1_050,
      totalPriceCents: 2_100,
      organization: 'Órgão BEC',
      state: 'SP',
      modality: 'Pregão Eletrônico',
      status: 'Encerrada(o) com Vencedor',
      sourceUrl: 'https://www.bec.sp.gov.br/edital/oc-15',
    });

    const results = await client.listMarketResults(query);
    expect(results.items[0]).toMatchObject({
      winner: expect.any(String),
      awardedPriceCents: 2_100,
      sourceUrl: 'https://www.bec.sp.gov.br/edital/oc-15',
    });
  });

  it('reaplica retry para falha HTTP transitória e respeita timeout', async () => {
    let attempts = 0;
    const retrying = new BecSpClient({
      baseUrl: 'https://bec.example.test',
      operation: 'pregaoM',
      timeoutMs: 1_000,
      maxRetries: 1,
      fetchFn: async () => {
        attempts += 1;
        if (attempts === 1) return new Response('{}', { status: 503 });
        return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
      },
    });

    await retrying.listOpportunities(query);
    expect(attempts).toBe(2);

    let aborted = false;
    const timingOut = new BecSpClient({
      operation: 'pregaoM',
      timeoutMs: 5,
      maxRetries: 0,
      fetchFn: async (_input, init) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          aborted = true;
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        }, { once: true });
      }),
    });

    await expect(timingOut.listOpportunities(query)).rejects.toMatchObject({ name: 'AbortError' });
    expect(aborted).toBe(true);
  });

  it('cria registry configurável e habilita BEC/SP somente quando solicitado', async () => {
    let requestedUrl = '';
    const clients = createSourceRegistry({
      pncpClient: { baseUrl: 'https://pncp.example.test', timeoutMs: 7, maxRetries: 0 },
      openDataClient: { baseUrl: 'https://open.example.test', timeoutMs: 8, maxRetries: 0 },
      becSpEnabled: true,
      becSp: {
        baseUrl: 'https://bec.example.test',
        operation: 'pregaoM',
        timeoutMs: 9,
        maxRetries: 0,
        fetchFn: async (input) => {
          requestedUrl = String(input);
          return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
        },
      },
    });

    expect(clients.map((client) => client.id)).toEqual(['PNCP', 'OPEN_DATA', 'BEC/SP']);
    await clients[2]!.listOpportunities(query);
    expect(requestedUrl).toContain('https://bec.example.test/BEC_API/API/pregaoM/NegociacaoItemOC/');
    expect(createSourceRegistry().map((client) => client.id)).toEqual(['PNCP', 'OPEN_DATA']);
  });

  it('constrói o registry padrão a partir de BEC_SP_ENABLED do ambiente', () => {
    expect(sourceRegistry.map((client) => client.id)).toEqual(['PNCP', 'OPEN_DATA']);
    expect(createDefaultSourceRegistry(loadEnv({ NODE_ENV: 'test', DATABASE_URL: ':memory:' })).map((client) => client.id))
      .toEqual(['PNCP', 'OPEN_DATA']);
    expect(createDefaultSourceRegistry(loadEnv({ NODE_ENV: 'test', DATABASE_URL: ':memory:', BEC_SP_ENABLED: 'true' })).map((client) => client.id))
      .toEqual(['PNCP', 'OPEN_DATA', 'BEC/SP']);
  });
});
