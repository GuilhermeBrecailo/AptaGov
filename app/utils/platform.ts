import { safeHttpsUrl } from '../viewModels/editalDocumentsViewModel';

const PLATFORMS: Array<{ hosts: string[]; label: string }> = [
  { hosts: ['bllcompras.com'], label: 'Abrir na BLL ↗' },
  { hosts: ['bnccompras.com'], label: 'Abrir na BNC ↗' },
  { hosts: ['serpro.gov.br', 'compras.gov.br', 'comprasnet.gov.br'], label: 'Abrir no Compras.gov ↗' },
  { hosts: ['licitacoes-e.com.br', 'licitacoes-e2.bb.com.br', 'licitacoes-e.bb.com.br'], label: 'Abrir no Licitações-e ↗' },
  { hosts: ['portaldecompraspublicas.com.br'], label: 'Abrir no Portal de Compras Públicas ↗' },
  { hosts: ['licitardigital.com.br'], label: 'Abrir na Licitar Digital ↗' },
  { hosts: ['licitamaisbrasil.com.br'], label: 'Abrir na Licita Mais Brasil ↗' },
  { hosts: ['licitanet.com.br'], label: 'Abrir na Licitanet ↗' },
  { hosts: ['comprasbr.com.br'], label: 'Abrir na ComprasBR ↗' },
  { hosts: ['pncp.gov.br'], label: 'Abrir no PNCP ↗' },
];

export function platformFor(url: string | null | undefined): { label: string; href: string | null } {
  const href = safeHttpsUrl(url);
  if (!href) return { label: 'Fonte oficial indisponível', href: null };
  const host = new URL(href).hostname.toLowerCase();
  const match = PLATFORMS.find(({ hosts }) => hosts.some((h) => host === h || host.endsWith(`.${h}`)));
  return { label: match?.label ?? 'Abrir no site do órgão ↗', href };
}
