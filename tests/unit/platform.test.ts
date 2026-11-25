import { describe, expect, it } from 'vitest';
import { platformFor } from '../../app/utils/platform';

describe('platformFor', () => {
  it.each([
    ['https://bllcompras.com/Process/ProcessView?x', 'Abrir na BLL ↗'],
    ['https://bnccompras.com/Process/ProcessView?x', 'Abrir na BNC ↗'],
    ['https://cnetmobile.estaleiro.serpro.gov.br/comprasnet-web/x', 'Abrir no Compras.gov ↗'],
    ['https://comprasnet.gov.br/x', 'Abrir no Compras.gov ↗'],
    ['https://www.comprasnet.gov.br/x', 'Abrir no Compras.gov ↗'],
    ['https://licitacoes-e2.bb.com.br/aop-web-estatico/x', 'Abrir no Licitações-e ↗'],
    ['https://pncp.gov.br/app/editais/1/2/3', 'Abrir no PNCP ↗'],
    ['https://bllcompras.com.evil.com/x', 'Abrir no site do órgão ↗'],
    ['https://notbllcompras.com/x', 'Abrir no site do órgão ↗'],
    ['https://compras.barueri.sp.gov.br', 'Abrir no site do órgão ↗'],
  ])('names the platform for %s', (url, label) => {
    expect(platformFor(url)).toEqual({ label, href: new URL(url).href });
  });

  it('rejects unsafe or non-https urls', () => {
    expect(platformFor('javascript:alert(1)').href).toBeNull();
    expect(platformFor('http://bllcompras.com').href).toBeNull();
  });

  it('reports unavailable source for empty input', () => {
    expect(platformFor(null)).toEqual({ label: 'Fonte oficial indisponível', href: null });
    expect(platformFor(undefined)).toEqual({ label: 'Fonte oficial indisponível', href: null });
  });
});
