import { safeHttpsUrl } from './editalDocumentsViewModel';
import type { PncpFileView, PncpItemView } from '../types';

const SECRET = 'Sigiloso';
const EMPTY = '—';
const moneyFormatter = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const numberFormatter = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 4 });

function cents(value: number | null): string {
  return value === null ? EMPTY : moneyFormatter.format(value / 100);
}

export function itemRows(items: PncpItemView[]) {
  return items.map((item) => ({
    number: item.number,
    description: item.description,
    quantityLabel: item.quantity === null ? EMPTY : [numberFormatter.format(item.quantity), item.unit].filter(Boolean).join(' '),
    unitValueLabel: item.confidential ? SECRET : cents(item.unitValueCents),
    totalValueLabel: item.confidential ? SECRET : cents(item.totalValueCents),
    criterion: item.criterion ?? EMPTY,
    benefit: item.benefit ?? EMPTY,
    status: item.status ?? EMPTY,
  }));
}

/** Soma só os itens não sigilosos; se todos forem sigilosos, o total também é. */
export function itemsTotalLabel(items: PncpItemView[]): string {
  if (!items.length) return EMPTY;
  const open = items.filter((item) => !item.confidential);
  if (!open.length) return SECRET;
  return cents(open.reduce((sum, item) => sum + (item.totalValueCents ?? 0), 0));
}

export function pageOf<T>(rows: T[], page: number, size = 50): { rows: T[]; pages: number } {
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const current = Math.min(Math.max(1, Math.floor(page) || 1), pages);
  return { rows: rows.slice((current - 1) * size, current * size), pages };
}

function isPncpHost(host: string): boolean {
  return host === 'pncp.gov.br' || host.endsWith('.pncp.gov.br');
}

/** Link só se https em pncp.gov.br (ou subdomínio); caso contrário, o arquivo aparece sem link. */
export function pncpFileHref(value: string | null | undefined): string | null {
  const href = safeHttpsUrl(value);
  return href && isPncpHost(new URL(href).hostname) ? href : null;
}

export function fileRows(files: PncpFileView[]) {
  return files.map((file) => ({
    title: file.title,
    typeName: file.typeName,
    publishedAt: file.publishedAt,
    superseded: file.superseded,
    href: pncpFileHref(file.url),
  }));
}

const BRT_PARTS = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

/** Data e hora no horário de Brasília, independente do fuso do servidor ou do navegador. Data sem fuso = Brasília. */
export function formatDateTime(value: string | null): string {
  if (!value) return EMPTY;
  const text = value.trim();
  const withZone = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(text) && !/(Z|[+-]\d{2}:?\d{2})$/i.test(text)
    ? `${text.replace(' ', 'T')}-03:00`
    : text;
  const date = new Date(withZone);
  if (Number.isNaN(date.getTime())) return EMPTY;
  const part = (type: Intl.DateTimeFormatPartTypes) => BRT_PARTS.formatToParts(date).find((p) => p.type === type)?.value ?? '';
  return `${part('day')}/${part('month')}/${part('year')} ${part('hour')}:${part('minute')}`;
}

export function staleLabel(fetchedAt: string | null): string {
  const label = formatDateTime(fetchedAt);
  return label === EMPTY ? 'Dados do PNCP desatualizados' : `Dados do PNCP de ${label}`;
}
