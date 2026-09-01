import { describe, expect, it } from 'vitest';
import { PncpClient } from '../../src/integrations/pncp/PncpClient';

describe('PncpClient', () => {
  it('consulta o endpoint oficial com os parâmetros esperados e interpreta o envelope paginado', async () => {
    let requestedUrl: URL | undefined;
    let requestedHeaders: HeadersInit | undefined;
    const client = new PncpClient({
      baseUrl: 'https://pncp.gov.br/api/consulta/v1',
      timeoutMs: 1_000,
      maxRetries: 0,
      fetchFn: async (input, init) => {
        requestedUrl = new URL(String(input));
        requestedHeaders = init?.headers;
        return new Response(JSON.stringify({
          data: [{ numeroControlePNCP: '123' }],
          totalRegistros: 1,
          totalPaginas: 1,
          numeroPagina: 1,
          paginasRestantes: 0,
          empty: false,
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

    expect(requestedUrl?.pathname).toBe('/api/consulta/v1/contratacoes/publicacao');
    expect(requestedUrl?.searchParams.get('dataInicial')).toBe('20260828');
    expect(requestedUrl?.searchParams.get('dataFinal')).toBe('20260831');
    expect(requestedUrl?.searchParams.get('pagina')).toBe('1');
    expect(requestedUrl?.searchParams.get('tamanhoPagina')).toBe('50');
    expect(requestedUrl?.searchParams.get('uf')).toBe('SP');
    expect(requestedUrl?.searchParams.get('codigoMunicipioIbge')).toBe('3550308');
    expect(requestedUrl?.searchParams.get('codigoModalidadeContratacao')).toBe('6');
    expect(new Headers(requestedHeaders).get('accept')).toBe('*/*');
    expect(page).toEqual({
      data: [{ numeroControlePNCP: '123' }],
      totalPaginas: 1,
      numeroPagina: 1,
      paginasRestantes: 0,
      empty: false,
    });
  });

  it('trata 204 No Content como uma página vazia válida', async () => {
    const client = new PncpClient({
      baseUrl: 'https://pncp.gov.br/api/consulta/v1',
      timeoutMs: 1_000,
      maxRetries: 0,
      fetchFn: async () => new Response(null, { status: 204 }),
    });

    await expect(client.fetchPublishedPage({
      dateFrom: '2026-08-28',
      dateTo: '2026-08-31',
      modality: '6',
    }, 1)).resolves.toEqual({
      data: [],
      numeroPagina: 1,
      empty: true,
    });
  });
});
