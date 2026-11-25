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

/** Document URL that is not https on the PNCP host: never fetched. */
export class UntrustedDocumentUrlError extends Error {
  constructor(message = 'Link do documento fora do PNCP — abra pelo link oficial') {
    super(message);
    this.name = 'UntrustedDocumentUrlError';
  }
}

/** Raw size budget per request (base64 adds ~33% over the 32 MB API limit); also the per-file download cap. */
export const MAX_DOCUMENT_BYTES = 24 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 60_000;
const PNCP_HOST = 'pncp.gov.br';

/** Non-2xx answer from the PNCP API; `status` lets callers tell 4xx from 5xx. */
export class PncpHttpError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'PncpHttpError';
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

const UNSUPPORTED_EXTENSIONS: ReadonlySet<string> = new Set(['zip', 'rar', '7z', 'doc', 'docx', 'odt', 'xls', 'xlsx']);

/** Only known non-PDF extensions are rejected up front; anything else is downloaded and checked for %PDF. */
function isSupported(title: string): boolean {
  const lastSegment = title.trim().toLowerCase().split('/').pop() ?? '';
  const dot = lastSegment.lastIndexOf('.');
  return dot === -1 || !UNSUPPORTED_EXTENSIONS.has(lastSegment.slice(dot + 1));
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
    if (!response.ok) throw new PncpHttpError(`Não foi possível listar os documentos do PNCP (HTTP ${response.status}).`, response.status);
    const body: unknown = await response.json();
    if (!Array.isArray(body)) return [];
    return body.flatMap((raw: unknown): PncpFile[] => {
      if (!raw || typeof raw !== 'object') return [];
      const item = raw as Record<string, unknown>;
      // Removed files keep appearing with statusAtivo false; items without a sequential or url cannot be used.
      if (item.statusAtivo === false) return [];
      if (typeof item.sequencialDocumento !== 'number' || !Number.isFinite(item.sequencialDocumento)) return [];
      if (typeof item.url !== 'string' || item.url.trim() === '') return [];
      return [{
        sequential: item.sequencialDocumento,
        typeName: String(item.tipoDocumentoNome ?? ''),
        title: String(item.titulo ?? ''),
        url: item.url
      }];
    });
  }

  async download(url: string): Promise<Buffer> {
    if (!isPncpFileUrl(url)) throw new UntrustedDocumentUrlError();
    const response = await this.fetchImpl(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
    if (!response.ok) throw new Error(`Não foi possível baixar o documento do PNCP (HTTP ${response.status}).`);
    const declared = Number(response.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > MAX_DOCUMENT_BYTES) throw new DocumentTooLargeError();
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > MAX_DOCUMENT_BYTES) throw new DocumentTooLargeError();
    if (bytes.subarray(0, 4).toString('latin1') !== '%PDF') throw new UnsupportedDocumentError();
    return bytes;
  }
}

function isPncpFileUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === PNCP_HOST;
  } catch {
    return false;
  }
}

export function fitToBudget<T extends SelectedDocument & { bytes: number }>(
  docs: T[],
  maxBytes = MAX_DOCUMENT_BYTES
):{ included: T[]; partial: boolean } {
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
  // Never hand the extractor an empty set (e.g. only a TR that is itself over the budget).
  if (included.length === 0) throw new DocumentTooLargeError();
  return { included, partial: included.length < docs.length };
}
