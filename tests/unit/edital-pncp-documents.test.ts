import { describe, expect, it, vi } from 'vitest';
import {
  DocumentTooLargeError,
  PncpDocumentClient,
  UnsupportedDocumentError,
  UntrustedDocumentUrlError,
  fitToBudget,
  parsePncpId,
  selectDocuments,
  type PncpFile,
  type SelectedDocument
} from '../../src/services/edital/pncpDocuments';

const MB = 1024 * 1024;
const PNCP_FILE = 'https://pncp.gov.br/pncp-api/v1/orgaos/10882594000165/compras/2026/640/arquivos/1';

function file(sequential: number, typeName: string, title: string): PncpFile {
  return { sequential, typeName, title, url: `https://pncp.gov.br/x/${sequential}` };
}

function doc(kind: SelectedDocument['kind'], bytes: number): SelectedDocument & { bytes: number } {
  return { ...file(1, kind, `${kind}.pdf`), kind, supported: true, bytes };
}

describe('parsePncpId', () => {
  it('extrai cnpj, ano e sequencial sem zeros à esquerda', () => {
    expect(parsePncpId('10882594000165-1-000640/2026')).toEqual({
      cnpj: '10882594000165',
      year: 2026,
      sequential: 640
    });
  });

  it('retorna null para formato inválido', () => {
    expect(parsePncpId('abc')).toBeNull();
    expect(parsePncpId('123-1-000640/2026')).toBeNull();
    expect(parsePncpId('10882594000165-1-000640')).toBeNull();
  });
});

describe('selectDocuments', () => {
  it('escolhe a versão mais recente e ignora outros tipos', () => {
    const result = selectDocuments([
      file(1, 'Edital', 'EDITAL_1.pdf'),
      file(2, 'Minuta do Contrato', 'minuta.pdf'),
      file(3, 'Estudo Técnico Preliminar', 'etp.pdf'),
      file(4, 'Edital', 'EDITAL_2.pdf'),
      file(5, 'Termo de Referência', 'tr.pdf')
    ]);
    expect(result.selected.map((d) => [d.kind, d.sequential])).toEqual([
      ['EDITAL', 4],
      ['TERMO_REFERENCIA', 5]
    ]);
    expect(result.superseded.map((d) => d.sequential)).toEqual([1]);
  });

  it('trata Projeto Básico como termo de referência', () => {
    const result = selectDocuments([file(2, 'Projeto Básico', 'pb.pdf')]);
    expect(result.selected[0]?.kind).toBe('TERMO_REFERENCIA');
  });

  it('marca formatos não PDF como não suportados', () => {
    const result = selectDocuments([file(1, 'Edital', 'edital.zip')]);
    expect(result.selected[0]?.supported).toBe(false);
    expect(selectDocuments([file(1, 'Edital', 'EDITAL.PDF')]).selected[0]?.supported).toBe(true);
    expect(selectDocuments([file(1, 'Edital', 'edital')]).selected[0]?.supported).toBe(true);
  });

  it('só extensões conhecidas que não são PDF ficam como não suportadas', () => {
    const supported = (title: string) => selectDocuments([file(1, 'Edital', title)]).selected[0]?.supported;
    for (const title of ['edital.zip', 'edital.RAR', 'edital.7z', 'edital.doc', 'edital.docx', 'edital.odt', 'planilha.xls', 'planilha.xlsx']) {
      expect(supported(title), title).toBe(false);
    }
    for (const title of ['Edital nº 1.234', 'Edital Concorrência 12.2026', 'EDITAL', 'edital.pdf', 'Edital v2.final']) {
      expect(supported(title), title).toBe(true);
    }
  });
});

describe('PncpDocumentClient', () => {
  it('monta a URL de listagem e mapeia os campos', async () => {
    const urls: string[] = [];
    const fetchImpl = (async (url: string) => {
      urls.push(url);
      return new Response(
        JSON.stringify([
          {
            sequencialDocumento: 1,
            tipoDocumentoNome: 'Edital',
            titulo: 'EDITAL.pdf',
            url: 'https://pncp.gov.br/pncp-api/v1/orgaos/10882594000165/compras/2026/640/arquivos/1'
          }
        ])
      );
    }) as unknown as typeof fetch;
    const client = new PncpDocumentClient(fetchImpl);
    const files = await client.list('10882594000165-1-000640/2026');
    expect(urls[0]).toBe('https://pncp.gov.br/api/pncp/v1/orgaos/10882594000165/compras/2026/640/arquivos');
    expect(files).toEqual([
      {
        sequential: 1,
        typeName: 'Edital',
        title: 'EDITAL.pdf',
        url: 'https://pncp.gov.br/pncp-api/v1/orgaos/10882594000165/compras/2026/640/arquivos/1'
      }
    ]);
  });

  it('rejeita id inválido e resposta HTTP de erro', async () => {
    const client = new PncpDocumentClient((async () => new Response('x', { status: 500 })) as unknown as typeof fetch);
    await expect(client.list('invalido')).rejects.toThrow();
    await expect(client.list('10882594000165-1-000640/2026')).rejects.toThrow();
  });

  it('ignora arquivos inativos e itens sem sequencial numérico ou sem url', async () => {
    const valid = { sequencialDocumento: 2, tipoDocumentoNome: 'Edital', titulo: 'edital.pdf', url: 'https://pncp.gov.br/a/2' };
    const fetchImpl = (async () => new Response(JSON.stringify([
      { ...valid, sequencialDocumento: 1, statusAtivo: false },
      valid,
      { ...valid, sequencialDocumento: 3, statusAtivo: true },
      { ...valid, sequencialDocumento: 'abc' },
      { ...valid, sequencialDocumento: null },
      { ...valid, sequencialDocumento: 4, url: '' },
      { ...valid, sequencialDocumento: 5, url: null },
      null
    ]))) as unknown as typeof fetch;
    const files = await new PncpDocumentClient(fetchImpl).list('10882594000165-1-000640/2026');
    expect(files.map((item) => item.sequential)).toEqual([2, 3]);
  });

  it('baixa PDF e rejeita bytes que não começam com %PDF', async () => {
    const pdf = new PncpDocumentClient((async () => new Response(Buffer.from('%PDF-1.7 abc'))) as unknown as typeof fetch);
    expect((await pdf.download(PNCP_FILE)).subarray(0, 4).toString()).toBe('%PDF');
    const zip = new PncpDocumentClient(
      (async () => new Response(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) as unknown as typeof fetch
    );
    await expect(zip.download(PNCP_FILE)).rejects.toBeInstanceOf(UnsupportedDocumentError);
  });

  it('baixa com timeout de 60 s (AbortSignal)', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    const inits: Array<RequestInit | undefined> = [];
    const client = new PncpDocumentClient((async (_url: string, init?: RequestInit) => {
      inits.push(init);
      return new Response(Buffer.from('%PDF-1.7'));
    }) as unknown as typeof fetch);
    await client.download(PNCP_FILE);
    expect(timeout).toHaveBeenCalledWith(60_000);
    expect(inits[0]?.signal).toBeInstanceOf(AbortSignal);
    timeout.mockRestore();
  });

  it('rejeita content-length acima de 24 MB sem ler o corpo', async () => {
    let read = false;
    const response = new Response(Buffer.from('%PDF-1.7'), { headers: { 'content-length': String(25 * MB) } });
    const original = response.arrayBuffer.bind(response);
    response.arrayBuffer = async () => {
      read = true;
      return original();
    };
    const client = new PncpDocumentClient((async () => response) as unknown as typeof fetch);
    // Compares a boolean so a failure never prints a 24 MB buffer.
    expect(await client.download(PNCP_FILE).then(() => false, (error: unknown) => error instanceof DocumentTooLargeError)).toBe(true);
    expect(read).toBe(false);
  });

  it('rejeita corpo acima de 24 MB mesmo sem content-length', async () => {
    const body = Buffer.alloc(24 * MB + 1);
    body.write('%PDF');
    const client = new PncpDocumentClient((async () => new Response(body)) as unknown as typeof fetch);
    // Compares a boolean so a failure never prints a 24 MB buffer.
    expect(await client.download(PNCP_FILE).then(() => false, (error: unknown) => error instanceof DocumentTooLargeError)).toBe(true);
  });

  it.each([
    'http://pncp.gov.br/pncp-api/v1/arquivo/1',
    'https://pncp.gov.br.evil.example/arquivo/1',
    'https://evil.example/pncp.gov.br/1',
    'javascript:alert(1)',
    'nao-e-url'
  ])('só baixa https do host pncp.gov.br (rejeita %s sem chamar fetch)', async (url) => {
    const fetchImpl = vi.fn(async () => new Response(Buffer.from('%PDF-1.7')));
    const client = new PncpDocumentClient(fetchImpl as unknown as typeof fetch);
    const error = await client.download(url).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(UntrustedDocumentUrlError);
    expect((error as Error).message).toBe('Link do documento fora do PNCP — abra pelo link oficial');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('fitToBudget', () => {
  it('inclui o edital e descarta o TR que estoura o orçamento', () => {
    const result = fitToBudget([doc('TERMO_REFERENCIA', 10 * MB), doc('EDITAL', 20 * MB)]);
    expect(result.included.map((d) => d.kind)).toEqual(['EDITAL']);
    expect(result.partial).toBe(true);
  });

  it('inclui ambos quando cabem', () => {
    const result = fitToBudget([doc('TERMO_REFERENCIA', 2 * MB), doc('EDITAL', 2 * MB)]);
    expect(result.included.map((d) => d.kind)).toEqual(['EDITAL', 'TERMO_REFERENCIA']);
    expect(result.partial).toBe(false);
  });

  it('lança DocumentTooLargeError quando só o edital já não cabe', () => {
    expect(() => fitToBudget([doc('EDITAL', 30 * MB)])).toThrow(DocumentTooLargeError);
  });

  it('lança DocumentTooLargeError quando nada cabe, mesmo sem edital', () => {
    expect(() => fitToBudget([doc('TERMO_REFERENCIA', 30 * MB)])).toThrow(DocumentTooLargeError);
    expect(() => fitToBudget([])).toThrow(DocumentTooLargeError);
  });
});
