export interface PncpPage<T> {
  data: T[];
  totalPaginas?: number;
  numeroPagina?: number;
  paginasRestantes?: number;
  empty?: boolean;
}

export async function paginateAll<T>(
  fetchPage: (page: number) => Promise<PncpPage<T>>,
  startPage = 1,
): Promise<T[]> {
  const records: T[] = [];
  let page = startPage;
  let totalPages: number | undefined;

  for (;;) {
    const response = await fetchPage(page);
    totalPages ??= response.totalPaginas;
    records.push(...response.data);

    if (totalPages === 0) {
      break;
    }
    if (totalPages !== undefined && (response.empty === true || response.data.length === 0)) {
      throw new Error(`PNCP returned an empty page before page ${totalPages}`);
    }
    if (totalPages !== undefined && page >= totalPages) {
      break;
    }
    if (totalPages === undefined) {
      if (response.empty === true || response.data.length === 0 || response.paginasRestantes === 0) break;
    }
    page += 1;
    if (page > 10_000) {
      throw new Error('PNCP pagination exceeded safety limit');
    }
  }

  return records;
}
