export class UnsupportedDocumentError extends Error {
  constructor(message = 'Edital em formato não suportado (ZIP/DOCX) — abra pelo link') {
    super(message);
    this.name = 'UnsupportedDocumentError';
  }
}

export class DocumentTooLargeError extends Error {
  constructor(message = 'Edital grande demais para análise automática — abra pelo link') {
    super(message);
    this.name = 'DocumentTooLargeError';
  }
}

export type PncpFile = { sequential: number; typeName: string; title: string; url: string };
export type SelectedDocument = PncpFile & { kind: 'EDITAL' | 'TERMO_REFERENCIA'; supported: boolean };

const PNCP_ID_PATTERN = /^(\d{14})-\d-(\d+)\/(\d{4})$/;

export function parsePncpId(pncpId: string): { cnpj: string; year: number; sequential: number } | null {
  const match = PNCP_ID_PATTERN.exec(pncpId.trim());
  if (!match) return null;
  return { cnpj: match[1]!, sequential: Number(match[2]), year: Number(match[3]) };
}

function kindOf(typeName: string): SelectedDocument['kind'] | null {
  if (typeName.includes('Edital')) return 'EDITAL';
  if (typeName.includes('Termo de Referência') || typeName.includes('Projeto Básico')) return 'TERMO_REFERENCIA';
  return null;
}

function isSupported(title: string): boolean {
  const lower = title.trim().toLowerCase();
  const lastSegment = lower.split('/').pop() ?? lower;
  return lower.endsWith('.pdf') || !lastSegment.includes('.');
}

export function selectDocuments(files: PncpFile[]): { selected: SelectedDocument[]; superseded: PncpFile[] } {
  const best = new Map<SelectedDocument['kind'], SelectedDocument>();
  const superseded: PncpFile[] = [];
  for (const file of files) {
    const kind = kindOf(file.typeName);
    if (!kind) continue;
    const candidate: SelectedDocument = { ...file, kind, supported: isSupported(file.title) };
    const current = best.get(kind);
    if (!current) {
      best.set(kind, candidate);
    } else if (candidate.sequential > current.sequential) {
      superseded.push(current);
      best.set(kind, candidate);
    } else {
      superseded.push(file);
    }
  }
  const selected = (['EDITAL', 'TERMO_REFERENCIA'] as const).flatMap((kind) => best.get(kind) ?? []);
  return { selected, superseded: superseded.sort((a, b) => a.sequential - b.sequential) };
}

export class PncpDocumentClient {
  constructor(
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly baseUrl = 'https://pncp.gov.br/api/pncp/v1'
  ) {}

  async list(pncpId: string): Promise<PncpFile[]> {
    const parsed = parsePncpId(pncpId);
    if (!parsed) throw new Error('Identificador PNCP inválido.');
    const url = `${this.baseUrl}/orgaos/${parsed.cnpj}/compras/${parsed.year}/${parsed.sequential}/arquivos`;
    const response = await this.fetchImpl(url, { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`Não foi possível listar os documentos do PNCP (HTTP ${response.status}).`);
    const body: unknown = await response.json();
    if (!Array.isArray(body)) return [];
    return body.map((item: Record<string, unknown>) => ({
      sequential: Number(item.sequencialDocumento),
      typeName: String(item.tipoDocumentoNome ?? ''),
      title: String(item.titulo ?? ''),
      url: String(item.url ?? '')
    }));
  }

  async download(url: string): Promise<Buffer> {
    const response = await this.fetchImpl(url);
    if (!response.ok) throw new Error(`Não foi possível baixar o documento do PNCP (HTTP ${response.status}).`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.subarray(0, 4).toString('latin1') !== '%PDF') throw new UnsupportedDocumentError();
    return bytes;
  }
}

export function fitToBudget<T extends SelectedDocument & { bytes: number }>(
  docs: T[],
  maxBytes = 24 * 1024 * 1024
): { included: T[]; partial: boolean } {
  const ordered = [...docs].sort((a, b) => Number(b.kind === 'EDITAL') - Number(a.kind === 'EDITAL'));
  const included: T[] = [];
  let used = 0;
  for (const doc of ordered) {
    if (used + doc.bytes <= maxBytes) {
      included.push(doc);
      used += doc.bytes;
    } else if (doc.kind === 'EDITAL') {
      throw new DocumentTooLargeError();
    }
  }
  return { included, partial: included.length < docs.length };
}
