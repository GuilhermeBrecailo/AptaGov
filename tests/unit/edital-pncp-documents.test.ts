import { describe, expect, it } from 'vitest';
import {
  DocumentTooLargeError,
  PncpDocumentClient,
  UnsupportedDocumentError,
  fitToBudget,
  parsePncpId,
  selectDocuments,
  type PncpFile,
  type SelectedDocument
} from '../../src/services/edital/pncpDocuments';

const MB = 1024 * 1024;

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

  it('baixa PDF e rejeita bytes que não começam com %PDF', async () => {
    const pdf = new PncpDocumentClient((async () => new Response(Buffer.from('%PDF-1.7 abc'))) as unknown as typeof fetch);
    expect((await pdf.download('https://x/1')).subarray(0, 4).toString()).toBe('%PDF');
    const zip = new PncpDocumentClient(
      (async () => new Response(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) as unknown as typeof fetch
    );
    await expect(zip.download('https://x/1')).rejects.toBeInstanceOf(UnsupportedDocumentError);
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
});
