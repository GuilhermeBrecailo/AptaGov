import { describe, expect, it } from 'vitest';
import { paginateAll } from '../../src/integrations/pncp/paginator';

describe('paginateAll', () => {
  it('consulta e inclui a última página indicada pelo PNCP', async () => {
    const pages = [
      { data: ['a'], totalPaginas: 3, numeroPagina: 1 },
      { data: ['b'], totalPaginas: 3, numeroPagina: 2 },
      { data: ['c'], totalPaginas: 3, numeroPagina: 3 },
    ];
    const requested: number[] = [];

    const result = await paginateAll(async (page) => {
      requested.push(page);
      return pages[page - 1]!;
    });

    expect(result).toEqual(['a', 'b', 'c']);
    expect(requested).toEqual([1, 2, 3]);
  });
});
