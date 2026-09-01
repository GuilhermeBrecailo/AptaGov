import { describe, expect, it } from 'vitest';
import { paginateAll } from '../../src/integrations/pncp/paginator';

describe('pagination without results', () => {
  it('accepts an empty response when PNCP reports zero pages', async () => {
    await expect(paginateAll(async () => ({ data: [], totalPaginas: 0, empty: true }))).resolves.toEqual([]);
  });
});

describe('segurança da paginação', () => {
  it('falha em vez de aceitar uma página vazia antes do total declarado', async () => {
    await expect(paginateAll(async (page) => page === 1
      ? { data: ['a'], totalPaginas: 2 }
      : { data: [], totalPaginas: 2, empty: true })).rejects.toThrow('empty page');
  });
});
