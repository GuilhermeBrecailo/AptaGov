import { describe, expect, it, vi } from 'vitest';
import { createTestDatabase } from '../../src/db/database';
import { PncpDetailClient } from '../../src/services/opportunityDetail/pncpDetailClient';
import { DETAIL_CACHE_TTL_MS, OpportunityDetailService } from '../../src/services/opportunityDetail/opportunityDetailService';

const PNCP_ID = '12345678000190-1-000123/2026';
const BASE = 'https://pncp.gov.br/api/pncp/v1/orgaos/12345678000190/compras/2026/123';
const T0 = new Date('2026-11-25T12:00:00Z');
const ID = { cnpj: '12345678000190', year: 2026, sequential: 123 };

const rawItem = (n: number, extra: Record<string, unknown> = {}) => ({
  numeroItem: n, descricao: `Item ${n}`, quantidade: 10, unidadeMedida: 'UN', valorUnitarioEstimado: 12.34, valorTotal: 123.4,
  orcamentoSigiloso: false, criterioJulgamentoNome: 'Menor preço', tipoBeneficioNome: 'Participação exclusiva ME/EPP',
  situacaoCompraItemNome: 'Em andamento', materialOuServicoNome: 'Material', ...extra
});

type Route = { total?: unknown; items?: (page: number) => unknown[]; files?: unknown[]; fail?: boolean };

function fakeFetch(route: Route) {
  const urls: string[] = [];
  const spy = vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    urls.push(url);
    if (route.fail) return new Response('erro', { status: 500 });
    if (url === `${BASE}/itens/quantidade`) return Response.json(route.total ?? 0);
    if (url.startsWith(`${BASE}/itens?`)) {
      const page = Number(new URL(url).searchParams.get('pagina'));
      return Response.json(route.items ? route.items(page) : []);
    }
    if (url === `${BASE}/arquivos`) return Response.json(route.files ?? []);
    return new Response('?', { status: 404 });
  });
  return { impl: spy as unknown as typeof fetch, urls, spy };
}

function setup(route: Route, now: () => Date = () => T0, pncpId = PNCP_ID) {
  const db = createTestDatabase();
  db.prepare("INSERT INTO opportunities (id, pncp_id, title, source_url, publication_date, created_at, updated_at) VALUES (1, ?, 't', 'https://x', '2026-11-01', '2026-11-01', '2026-11-01')").run(pncpId);
  const f = fakeFetch(route);
  const service = new OpportunityDetailService({ db, client: new PncpDetailClient(f.impl), now });
  return { db, f, service };
}

describe('PncpDetailClient', () => {
  it('maps items to cents and hides values of confidential budgets', async () => {
    const f = fakeFetch({ total: 2, items: () => [rawItem(1), rawItem(2, { orcamentoSigiloso: true })] });
    const out = await new PncpDetailClient(f.impl).listItems(ID);
    expect(out.total).toBe(2);
    expect(out.truncated).toBe(false);
    expect(out.items[0]).toEqual({
      number: 1, description: 'Item 1', quantity: 10, unit: 'UN', unitValueCents: 1234, totalValueCents: 12340, confidential: false,
      criterion: 'Menor preço', benefit: 'Participação exclusiva ME/EPP', status: 'Em andamento', kind: 'Material'
    });
    expect(out.items[1]).toMatchObject({ number: 2, confidential: true, unitValueCents: null, totalValueCents: null });
  });

  it('paginates in pages of 500', async () => {
    const f = fakeFetch({ total: 600, items: (p) => Array.from({ length: p === 1 ? 500 : 100 }, (_, i) => rawItem((p - 1) * 500 + i + 1)) });
    const out = await new PncpDetailClient(f.impl).listItems(ID);
    expect(out.items).toHaveLength(600);
    expect(f.urls.filter((u) => u.includes('/itens?'))).toEqual([`${BASE}/itens?pagina=1&tamanhoPagina=500`, `${BASE}/itens?pagina=2&tamanhoPagina=500`]);
  });

  it('stops paging on a short page', async () => {
    const f = fakeFetch({ total: 900, items: () => [rawItem(1), rawItem(2)] });
    const out = await new PncpDetailClient(f.impl).listItems(ID);
    expect(out.items).toHaveLength(2);
    expect(f.urls.filter((u) => u.includes('/itens?'))).toHaveLength(1);
  });

  it('terminates when pages hold only invalid items', async () => {
    const f = fakeFetch({ total: 1200, items: () => Array.from({ length: 500 }, () => ({ foo: 'bar' })) });
    const out = await new PncpDetailClient(f.impl).listItems(ID);
    expect(out.items).toEqual([]);
    expect(f.urls.filter((u) => u.includes('/itens?'))).toHaveLength(2);
  });

  it('rejects a non-numeric item count', async () => {
    const f = fakeFetch({ total: 'abc' });
    await expect(new PncpDetailClient(f.impl).listItems(ID)).rejects.toThrow();
  });

  it('truncates above 1000 items keeping the real total', async () => {
    const f = fakeFetch({ total: 1200, items: (p) => Array.from({ length: 500 }, (_, i) => rawItem((p - 1) * 500 + i + 1)) });
    const out = await new PncpDetailClient(f.impl).listItems(ID);
    expect(out.items).toHaveLength(1000);
    expect(out.total).toBe(1200);
    expect(out.truncated).toBe(true);
  });
});

describe('OpportunityDetailService', () => {
  const files = [
    { sequencialDocumento: 1, tipoDocumentoNome: 'Edital', titulo: 'v1.pdf', url: 'https://pncp.gov.br/f/1', dataPublicacaoPncp: '2026-11-01T10:00:00' },
    { sequencialDocumento: 2, tipoDocumentoNome: 'Edital', titulo: 'v2.pdf', url: 'https://pncp.gov.br/f/2' },
    { sequencialDocumento: 3, tipoDocumentoNome: 'Anexo', titulo: 'a.pdf', url: 'https://pncp.gov.br/f/3' }
  ];

  it('returns items and files with superseded marking, then writes the cache', async () => {
    const { service, db } = setup({ total: 1, items: () => [rawItem(1)], files });
    const out = await service.get(1);
    expect(out).toMatchObject({ source: 'pncp', itemsTotal: 1, truncated: false, stale: false, unavailable: false, fetchedAt: T0.toISOString() });
    expect(out.files).toEqual([
      { title: 'v1.pdf', typeName: 'Edital', url: 'https://pncp.gov.br/f/1', publishedAt: '2026-11-01T10:00:00', superseded: true },
      { title: 'v2.pdf', typeName: 'Edital', url: 'https://pncp.gov.br/f/2', publishedAt: null, superseded: false },
      { title: 'a.pdf', typeName: 'Anexo', url: 'https://pncp.gov.br/f/3', publishedAt: null, superseded: false }
    ]);
    expect(db.prepare('SELECT COUNT(*) AS n FROM opportunity_detail_cache').get()).toEqual({ n: 1 });
  });

  it('serves a valid cache without calling fetch', async () => {
    const { service, f } = setup({ total: 1, items: () => [rawItem(1)], files });
    await service.get(1);
    f.spy.mockClear();
    const out = await service.get(1);
    expect(f.spy).not.toHaveBeenCalled();
    expect(out.items).toHaveLength(1);
    expect(out.stale).toBe(false);
  });

  it('refetches and rewrites an expired cache', async () => {
    let now = T0;
    const { service, f, db } = setup({ total: 1, items: () => [rawItem(1)], files }, () => now);
    await service.get(1);
    f.spy.mockClear();
    now = new Date(T0.getTime() + DETAIL_CACHE_TTL_MS + 1000);
    const out = await service.get(1);
    expect(f.spy).toHaveBeenCalled();
    expect(out.fetchedAt).toBe(now.toISOString());
    expect(db.prepare('SELECT fetched_at FROM opportunity_detail_cache').get()).toEqual({ fetched_at: now.toISOString() });
  });

  it('serves stale cache when PNCP fails', async () => {
    let now = T0;
    const route: Route = { total: 1, items: () => [rawItem(1)], files };
    const { service } = setup(route, () => now);
    await service.get(1);
    route.fail = true;
    now = new Date(T0.getTime() + DETAIL_CACHE_TTL_MS + 1000);
    const out = await service.get(1);
    expect(out).toMatchObject({ stale: true, unavailable: false, fetchedAt: T0.toISOString() });
    expect(out.items).toHaveLength(1);
  });

  it('flags unavailable when PNCP fails without cache', async () => {
    const { service } = setup({ fail: true });
    const out = await service.get(1);
    expect(out).toMatchObject({ source: 'pncp', unavailable: true, stale: false, items: [], files: [], fetchedAt: null });
  });

  it('returns platform-only for an invalid pncpId without fetching', async () => {
    const { service, f } = setup({}, () => T0, 'manual-123');
    const out = await service.get(1);
    expect(out).toMatchObject({ source: 'platform-only', items: [], files: [], unavailable: false, stale: false });
    expect(f.spy).not.toHaveBeenCalled();
  });

  it('keeps the cache untouched and serves it stale when the item count is garbage', async () => {
    let now = T0;
    const route: Route = { total: 1, items: () => [rawItem(1)], files };
    const { service, db } = setup(route, () => now);
    await service.get(1);
    route.total = 'garbage';
    now = new Date(T0.getTime() + DETAIL_CACHE_TTL_MS + 1000);
    const out = await service.get(1);
    expect(out).toMatchObject({ stale: true, itemsTotal: 1, fetchedAt: T0.toISOString() });
    expect(db.prepare('SELECT items_total, fetched_at FROM opportunity_detail_cache').get()).toEqual({ items_total: 1, fetched_at: T0.toISOString() });
  });

  it('treats a corrupt cache row as no cache', async () => {
    const route: Route = { total: 1, items: () => [rawItem(1)], files };
    const { service, db } = setup(route);
    await service.get(1);
    db.prepare("UPDATE opportunity_detail_cache SET items_json = '{broken'").run();
    const refetched = await service.get(1);
    expect(refetched).toMatchObject({ stale: false, unavailable: false });
    expect(refetched.items).toHaveLength(1);
    db.prepare("UPDATE opportunity_detail_cache SET files_json = '{broken'").run();
    route.fail = true;
    expect(await service.get(1)).toMatchObject({ unavailable: true, stale: false, items: [] });
  });
});
