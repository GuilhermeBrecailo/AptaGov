import { describe, expect, it } from 'vitest';
import { documentKindLabel, safeHttpsUrl } from '../../app/viewModels/editalDocumentsViewModel';

describe('safeHttpsUrl', () => {
  it('aceita https e devolve a URL normalizada', () => {
    expect(safeHttpsUrl('https://pncp.gov.br/pncp-api/v1/arquivos/1')).toBe('https://pncp.gov.br/pncp-api/v1/arquivos/1');
  });

  it.each([
    'javascript:alert(1)',
    ' javascript:alert(1)',
    'JAVASCRIPT:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'http://pncp.gov.br/arquivo',
    'vbscript:msgbox(1)',
    '//evil.example/x',
    '/relativo',
    '',
    'nao-e-url'
  ])('rejeita %s', (url) => {
    expect(safeHttpsUrl(url)).toBeNull();
  });

  it('rejeita valores que não são texto', () => {
    expect(safeHttpsUrl(null)).toBeNull();
    expect(safeHttpsUrl(undefined)).toBeNull();
  });
});

describe('documentKindLabel', () => {
  it('traduz os tipos conhecidos e mantém os demais', () => {
    expect(documentKindLabel('EDITAL')).toBe('Edital');
    expect(documentKindLabel('TERMO_REFERENCIA')).toBe('Termo de referência');
    expect(documentKindLabel('OUTRO')).toBe('OUTRO');
  });
});
