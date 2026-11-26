import { describe, expect, it } from 'vitest';
import { fileRows, formatDateTime, itemRows, itemsTotalLabel, pageOf, staleLabel } from '../../app/viewModels/opportunityDetailViewModel';
import type { PncpFileView, PncpItemView } from '../../app/types';

function item(overrides: Partial<PncpItemView> = {}): PncpItemView {
  return {
    number: 1, description: 'Caneta', quantity: 10, unit: 'UN', unitValueCents: 150, totalValueCents: 1500,
    confidential: false, criterion: 'Menor preço', benefit: null, status: 'Em andamento', kind: 'Material', ...overrides,
  };
}

describe('opportunityDetailViewModel', () => {
  it('formata moeda em pt-BR com centavos', () => {
    const [row] = itemRows([item({ unitValueCents: 123456, totalValueCents: 1234560 })]);
    expect(row!.unitValueLabel.replace(/\s/g, ' ')).toBe('R$ 1.234,56');
    expect(row!.totalValueLabel.replace(/\s/g, ' ')).toBe('R$ 12.345,60');
    expect(row!.quantityLabel).toBe('10 UN');
  });

  it('mostra Sigiloso para itens sigilosos e traço para valores ausentes', () => {
    const [secret, empty] = itemRows([
      item({ confidential: true, unitValueCents: null, totalValueCents: null }),
      item({ number: 2, quantity: null, unit: null, unitValueCents: null, totalValueCents: null }),
    ]);
    expect(secret!.unitValueLabel).toBe('Sigiloso');
    expect(secret!.totalValueLabel).toBe('Sigiloso');
    expect(empty!.unitValueLabel).toBe('—');
    expect(empty!.quantityLabel).toBe('—');
  });

  it('soma apenas itens não sigilosos e mostra Sigiloso se todos forem', () => {
    const total = itemsTotalLabel([item({ totalValueCents: 1000 }), item({ totalValueCents: 500 }), item({ confidential: true, totalValueCents: 99999 })]);
    expect(total.replace(/\s/g, ' ')).toBe('R$ 15,00');
    expect(itemsTotalLabel([item({ confidential: true }), item({ confidential: true })])).toBe('Sigiloso');
    expect(itemsTotalLabel([])).toBe('—');
  });

  it('pagina de 50 em 50', () => {
    const rows = Array.from({ length: 120 }, (_, index) => index);
    expect(pageOf(rows, 1).rows).toHaveLength(50);
    expect(pageOf(rows, 1).pages).toBe(3);
    expect(pageOf(rows, 3).rows).toEqual(rows.slice(100));
    expect(pageOf(rows, 99).rows).toEqual(rows.slice(100));
    expect(pageOf([], 1)).toEqual({ rows: [], pages: 1 });
  });

  it('só gera link para https em pncp.gov.br', () => {
    const file = (url: string): PncpFileView => ({ title: 't', typeName: 'Edital', url, publishedAt: null, superseded: false });
    const rows = fileRows([
      file('https://pncp.gov.br/pncp-api/v1/x.pdf'),
      file('https://www.pncp.gov.br/a.pdf'),
      file('http://pncp.gov.br/a.pdf'),
      file('https://evil.example.com/a.pdf'),
      file('https://pncp.gov.br.evil.com/a.pdf'),
      file('javascript:alert(1)'),
    ]);
    expect(rows.map((row) => row.href)).toEqual([
      'https://pncp.gov.br/pncp-api/v1/x.pdf', 'https://www.pncp.gov.br/a.pdf', null, null, null, null,
    ]);
  });

  it('formata a data de atualização em dd/mm/aaaa HH:mm', () => {
    expect(staleLabel('2026-11-25T12:05:00.000Z')).toBe('Dados do PNCP de 25/11/2026 09:05');
    expect(staleLabel(null)).toBe('Dados do PNCP desatualizados');
  });
});

describe('formatDateTime no horário de Brasília (servidor em UTC)', () => {
  it('mostra ISO com Z no horário de Brasília e trata data sem fuso como Brasília', () => {
    expect(formatDateTime('2026-12-08T02:59:00.000Z')).toBe('07/12/2026 23:59');
    expect(formatDateTime('2027-01-20T11:00:00')).toBe('20/01/2027 11:00');
    expect(formatDateTime('2026-12-10T10:00:00-03:00')).toBe('10/12/2026 10:00');
    expect(formatDateTime('não é data')).toBe(formatDateTime(null));
  });
});
