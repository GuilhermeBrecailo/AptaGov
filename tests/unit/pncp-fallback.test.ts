import { describe, expect, it } from 'vitest';
import { createTestDatabase } from '../../src/db/database';
import { OpportunityRepository } from '../../src/repositories/opportunityRepository';
import { OpenDataClient } from '../../src/integrations/pncp/OpenDataClient';
import { syncFromPncp, type PncpSyncClient } from '../../src/services/syncService';
import type { FilterConfig } from '../../src/domain/types';

const filters: FilterConfig = {
  lookbackDays: 3,
  states: ['SP'],
  citiesIbge: [],
  modalities: ['6'],
  keywords: ['software'],
  excludedKeywords: [],
  minimumScore: 45,
  estimatedValueMinCents: 0,
  scoreWeights: { keyword: 50, region: 20, value: 10, deadline: 20 },
};

describe('fallback do PNCP', () => {
  it('consulta as fontes complementares e consolida o mesmo identificador PNCP', async () => {
    const db = createTestDatabase();
    const repository = new OpportunityRepository(db);
    const primaryPages: number[] = [];
    const complementaryPages: number[] = [];
    const pncpId = '12345678901234-1-000001/2026';
    const primary: PncpSyncClient = {
      source: 'PNCP',
      fetchPublishedPage: async (_query, page) => {
        primaryPages.push(page);
        return { data: [{ numeroControlePNCP: pncpId, objetoCompra: 'Edital do PNCP' }], totalPaginas: 1 };
      },
    };
    const complementary: PncpSyncClient = {
      source: 'OPEN_DATA',
      fetchPublishedPage: async (_query, page) => {
        complementaryPages.push(page);
        return { data: [{ numeroControlePNCP: pncpId, objetoCompra: 'Edital dos Dados Abertos' }], totalPaginas: 1 };
      },
    };

    const result = await syncFromPncp([primary, complementary], repository, filters, new Date('2026-08-31T12:00:00.000Z'));

    expect(primaryPages).toEqual([1]);
    expect(complementaryPages).toEqual([1]);
    expect(result.received).toBe(1);
    expect(result.created).toBe(1);
    expect(repository.count()).toBe(1);
    expect(repository.findByPncpId(pncpId)?.source).toBe('PNCP');
  });

  it('continua com a fonte principal quando a complementar fica indisponível', async () => {
    const db = createTestDatabase();
    const repository = new OpportunityRepository(db);
    let complementaryCalled = false;
    const primary: PncpSyncClient = {
      source: 'PNCP',
      fetchPublishedPage: async () => ({ data: [{ numeroControlePNCP: 'primary-1', objetoCompra: 'Edital principal' }], totalPaginas: 1 }),
    };
    const complementary: PncpSyncClient = {
      source: 'OPEN_DATA',
      fetchPublishedPage: async () => {
        complementaryCalled = true;
        throw new Error('Dados Abertos indisponível');
      },
    };

    const result = await syncFromPncp([primary, complementary], repository, filters, new Date('2026-08-31T12:00:00.000Z'));

    expect(complementaryCalled).toBe(true);
    expect(result.created).toBe(1);
    expect(repository.count()).toBe(1);
  });

  it('reinicia a paginação na fonte alternativa e registra a origem sem duplicar', async () => {
    const db = createTestDatabase();
    const repository = new OpportunityRepository(db);
    const primaryPages: number[] = [];
    const fallbackPages: number[] = [];
    const primary: PncpSyncClient = {
      source: 'PNCP',
      fetchPublishedPage: async (_query, page) => {
        primaryPages.push(page);
        throw new Error('PNCP indisponível');
      },
    };
    const fallback: PncpSyncClient = {
      source: 'OPEN_DATA',
      fetchPublishedPage: async (_query, page) => {
        fallbackPages.push(page);
        return page === 1
          ? { data: [{ numeroControlePNCP: 'fallback-1', objetoCompra: 'Software público' }], totalPaginas: 2 }
          : { data: [{ numeroControlePNCP: 'fallback-2', objetoCompra: 'Software privado' }], totalPaginas: 2 };
      },
    };

    const result = await syncFromPncp([primary, fallback], repository, filters, new Date('2026-08-31T12:00:00.000Z'));

    expect(primaryPages).toEqual([1]);
    expect(fallbackPages).toEqual([1, 2]);
    expect(result.received).toBe(2);
    expect(repository.count()).toBe(2);
    expect(repository.list().every((opportunity) => opportunity.source === 'OPEN_DATA')).toBe(true);
  });

  it('interpreta a resposta oficial da API de Dados Abertos', async () => {
    let requestedUrl: URL | undefined;
    const client = new OpenDataClient({
      baseUrl: 'https://dadosabertos.compras.gov.br',
      timeoutMs: 1_000,
      maxRetries: 0,
      fetchFn: async (input) => {
        requestedUrl = new URL(String(input));
        return new Response(JSON.stringify({
          resultado: [{
            numeroControlePNCP: 'open-data-1',
            objetoCompra: 'Sistema de atendimento',
            dataPublicacaoPncp: '2026-08-31T10:00:00.000Z',
          }],
          totalRegistros: 1,
          totalPaginas: 1,
          paginasRestantes: 0,
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      },
    });

    const page = await client.fetchPublishedPage({
      dateFrom: '2026-08-28',
      dateTo: '2026-08-31',
      state: 'SP',
      cityIbge: '3550308',
      modality: '6',
    }, 1);

    expect(requestedUrl?.pathname).toBe('/modulo-contratacoes/1_consultarContratacoes_PNCP_14133');
    expect(requestedUrl?.searchParams.get('dataPublicacaoPncpInicial')).toBe('2026-08-28');
    expect(requestedUrl?.searchParams.get('dataPublicacaoPncpFinal')).toBe('2026-08-31');
    expect(requestedUrl?.searchParams.get('codigoModalidade')).toBe('6');
    expect(requestedUrl?.searchParams.get('unidadeOrgaoUfSigla')).toBe('SP');
    expect(requestedUrl?.searchParams.get('unidadeOrgaoCodigoIbge')).toBe('3550308');
    expect(page.data[0]).toMatchObject({ numeroControlePNCP: 'open-data-1', objetoCompra: 'Sistema de atendimento' });
    expect(page.totalPaginas).toBe(1);
  });
});
