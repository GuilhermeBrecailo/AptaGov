export interface PncpPage<T> {
  data: T[];
  totalPaginas?: number;
  numeroPagina?: number;
  paginasRestantes?: number;
  empty?: boolean;
}

export interface PaginatedPage<T> {
  page: number;
  response: PncpPage<T>;
  hasNext: boolean;
  nextPage: number | null;
}

export async function* paginatePages<T>(
  fetchPage: (page: number) => Promise<PncpPage<T>>,
  startPage = 1,
): AsyncGenerator<PaginatedPage<T>> {
  let page = startPage;
  let totalPages: number | undefined;

  for (;;) {
    const response = await fetchPage(page);
    totalPages ??= response.totalPaginas;

    if (totalPages === 0) break;
    if (totalPages !== undefined && (response.empty === true || response.data.length === 0)) {
      throw new Error(`PNCP returned an empty page before page ${totalPages}`);
    }

    const hasNext = totalPages !== undefined
      ? page < totalPages
      : response.empty !== true && response.data.length > 0 && response.paginasRestantes !== 0;
    yield { page, response, hasNext, nextPage: hasNext ? page + 1 : null };
    if (!hasNext) break;

    page += 1;
    if (page > 10_000) {
      throw new Error('PNCP pagination exceeded safety limit');
    }
  }
}

export async function paginateAll<T>(
  fetchPage: (page: number) => Promise<PncpPage<T>>,
  startPage = 1,
): Promise<T[]> {
  const records: T[] = [];
  for await (const { response } of paginatePages(fetchPage, startPage)) {
    records.push(...response.data);
  }
  return records;
}
