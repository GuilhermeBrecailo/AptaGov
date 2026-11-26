import { PncpDocumentClient, PncpHttpError, parsePncpId, selectDocuments } from '../edital/pncpDocuments';

export type PncpItem = {
  number: number;
  description: string;
  quantity: number | null;
  unit: string | null;
  unitValueCents: number | null;
  totalValueCents: number | null;
  confidential: boolean;
  criterion: string | null;
  benefit: string | null;
  status: string | null;
  kind: string | null;
};

export type PncpFileView = { title: string; typeName: string; url: string; publishedAt: string | null; superseded: boolean };
export type PncpDetailId = { cnpj: string; year: number; sequential: number };

const BASE_URL = 'https://pncp.gov.br/api/pncp/v1';
const CALL_TIMEOUT_MS = 20_000;
const PAGE_SIZE = 500;
const MAX_ITEMS = 1_000;

const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() !== '' ? value.trim() : null);
const num = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);
const cents = (value: unknown): number | null => {
  const reais = num(value);
  return reais === null ? null : Math.round(reais * 100);
};

function toItem(raw: unknown): PncpItem[] {
  if (!raw || typeof raw !== 'object') return [];
  const r = raw as Record<string, unknown>;
  const number = num(r.numeroItem);
  if (number === null) return [];
  const confidential = r.orcamentoSigiloso === true;
  return [{
    number,
    description: text(r.descricao) ?? '',
    quantity: num(r.quantidade),
    unit: text(r.unidadeMedida),
    unitValueCents: confidential ? null : cents(r.valorUnitarioEstimado),
    totalValueCents: confidential ? null : cents(r.valorTotal),
    confidential,
    criterion: text(r.criterioJulgamentoNome),
    benefit: text(r.tipoBeneficioNome),
    status: text(r.situacaoCompraItemNome),
    kind: text(r.materialOuServicoNome)
  }];
}

export class PncpDetailClient {
  private readonly documents: PncpDocumentClient;

  constructor(private readonly fetchImpl: typeof fetch = fetch) {
    this.documents = new PncpDocumentClient(this.timedFetch, BASE_URL);
  }

  private readonly timedFetch: typeof fetch = (input, init) =>
    this.fetchImpl(input, { ...init, signal: AbortSignal.timeout(CALL_TIMEOUT_MS) });

  private async getJson(url: string): Promise<unknown> {
    const response = await this.timedFetch(url, { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new PncpHttpError(`PNCP respondeu HTTP ${response.status}.`, response.status);
    return response.json();
  }

  async listItems(id: PncpDetailId): Promise<{ items: PncpItem[]; total: number; truncated: boolean }> {
    const base = `${BASE_URL}/orgaos/${id.cnpj}/compras/${id.year}/${id.sequential}/itens`;
    const rawTotal = await this.getJson(`${base}/quantidade`);
    if (typeof rawTotal !== 'number' || !Number.isFinite(rawTotal) || rawTotal < 0) {
      throw new Error('PNCP devolveu uma quantidade de itens inválida.');
    }
    const total = Math.floor(rawTotal);
    const pages = Math.ceil(Math.min(total, MAX_ITEMS) / PAGE_SIZE);
    const items: PncpItem[] = [];
    for (let page = 1; page <= pages; page += 1) {
      const body = await this.getJson(`${base}?pagina=${page}&tamanhoPagina=${PAGE_SIZE}`);
      if (!Array.isArray(body)) break;
      items.push(...body.flatMap(toItem));
      if (body.length < PAGE_SIZE) break;
    }
    return { items: items.slice(0, MAX_ITEMS), total, truncated: total > MAX_ITEMS };
  }

  async listFiles(pncpId: string): Promise<PncpFileView[]> {
    if (!parsePncpId(pncpId)) throw new Error('Identificador PNCP inválido.');
    const files = await this.documents.list(pncpId);
    const superseded = new Set(selectDocuments(files).superseded.map((file) => file.sequential));
    return [...files]
      .sort((a, b) => a.sequential - b.sequential)
      .map((file) => ({
        title: file.title,
        typeName: file.typeName,
        url: file.url,
        publishedAt: file.publishedAt ?? null,
        superseded: superseded.has(file.sequential)
      }));
  }
}
