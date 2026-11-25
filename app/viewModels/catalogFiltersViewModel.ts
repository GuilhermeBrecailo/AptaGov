export type SituationFilter = 'open' | 'suspended' | 'cancelled' | 'all';

export interface CatalogFilterState {
  situation: SituationFilter;
  modalities: string[];
  disputeModes: string[];
  city: string;
  publishedFrom: string;
  publishedTo: string;
  deadlineFrom: string;
  deadlineTo: string;
}

export const DEFAULT_CATALOG_FILTERS: CatalogFilterState = {
  situation: 'open', modalities: [], disputeModes: [], city: '',
  publishedFrom: '', publishedTo: '', deadlineFrom: '', deadlineTo: '',
};

export const SITUATION_OPTIONS: Array<{ value: SituationFilter; label: string }> = [
  { value: 'open', label: 'Em andamento' },
  { value: 'suspended', label: 'Suspensas' },
  { value: 'cancelled', label: 'Revogadas ou anuladas' },
  { value: 'all', label: 'Todas' },
];

/** Chaves de query gerenciadas pelos filtros; usadas para preservar os demais parâmetros da URL. */
export const CATALOG_FILTER_QUERY_KEYS: readonly string[] = [
  'situation', 'modalities', 'disputeModes', 'city', 'publishedFrom', 'publishedTo', 'deadlineFrom', 'deadlineTo',
];

function single(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function list(value: unknown): string[] {
  const parts = Array.isArray(value) ? value : [value];
  const items = parts.flatMap((part) => (typeof part === 'string' ? part.split(',') : [])).map((item) => item.trim()).filter(Boolean);
  return [...new Set(items)];
}

function isoDate(value: unknown): string {
  const text = single(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return '';
  const date = new Date(`${text}T00:00:00Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text ? '' : text;
}

export function filtersFromQuery(query: Record<string, unknown>): CatalogFilterState {
  const situation = single(query.situation);
  return {
    situation: SITUATION_OPTIONS.some((option) => option.value === situation) ? (situation as SituationFilter) : 'open',
    modalities: list(query.modalities),
    disputeModes: list(query.disputeModes),
    city: single(query.city),
    publishedFrom: isoDate(query.publishedFrom),
    publishedTo: isoDate(query.publishedTo),
    deadlineFrom: isoDate(query.deadlineFrom),
    deadlineTo: isoDate(query.deadlineTo),
  };
}

export function filtersToQuery(state: CatalogFilterState): Record<string, string> {
  const query: Record<string, string> = {};
  if (state.situation !== 'open') query.situation = state.situation;
  if (state.modalities.length) query.modalities = state.modalities.join(',');
  if (state.disputeModes.length) query.disputeModes = state.disputeModes.join(',');
  if (state.city) query.city = state.city;
  if (state.publishedFrom) query.publishedFrom = state.publishedFrom;
  if (state.publishedTo) query.publishedTo = state.publishedTo;
  if (state.deadlineFrom) query.deadlineFrom = state.deadlineFrom;
  if (state.deadlineTo) query.deadlineTo = state.deadlineTo;
  return query;
}

function brDate(iso: string): string {
  return iso.split('-').reverse().join('/');
}

function rangeLabel(name: string, from: string, to: string): string {
  if (from && to) return `${name}: ${brDate(from)}–${brDate(to)}`;
  return from ? `${name}: a partir de ${brDate(from)}` : `${name}: até ${brDate(to)}`;
}

export function activeFilterChips(state: CatalogFilterState): Array<{ key: string; label: string }> {
  const chips: Array<{ key: string; label: string }> = [];
  if (state.situation !== 'all') {
    chips.push({ key: 'situation', label: `Situação: ${SITUATION_OPTIONS.find((option) => option.value === state.situation)!.label}` });
  }
  for (const value of state.modalities) chips.push({ key: `modalities:${value}`, label: `Modalidade: ${value}` });
  for (const value of state.disputeModes) chips.push({ key: `disputeModes:${value}`, label: `Tipo de disputa: ${value}` });
  if (state.city) chips.push({ key: 'city', label: `Cidade: ${state.city}` });
  if (state.publishedFrom || state.publishedTo) chips.push({ key: 'published', label: rangeLabel('Publicação', state.publishedFrom, state.publishedTo) });
  if (state.deadlineFrom || state.deadlineTo) chips.push({ key: 'deadline', label: rangeLabel('Prazo', state.deadlineFrom, state.deadlineTo) });
  return chips;
}

export function removeFilterChip(state: CatalogFilterState, key: string): CatalogFilterState {
  const separator = key.indexOf(':');
  const field = separator === -1 ? key : key.slice(0, separator);
  const value = separator === -1 ? '' : key.slice(separator + 1);
  switch (field) {
    case 'situation': return { ...state, situation: 'all' };
    case 'modalities': return { ...state, modalities: state.modalities.filter((item) => item !== value) };
    case 'disputeModes': return { ...state, disputeModes: state.disputeModes.filter((item) => item !== value) };
    case 'city': return { ...state, city: '' };
    case 'published': return { ...state, publishedFrom: '', publishedTo: '' };
    case 'deadline': return { ...state, deadlineFrom: '', deadlineTo: '' };
    default: return state;
  }
}

/** Grupos de filtro fora do padrão, exibidos no botão "Mais filtros". */
export function countAdvancedFilters(state: CatalogFilterState): number {
  return [
    state.situation !== 'open',
    state.modalities.length > 0,
    state.disputeModes.length > 0,
    state.city !== '',
    Boolean(state.publishedFrom || state.publishedTo),
    Boolean(state.deadlineFrom || state.deadlineTo),
  ].filter(Boolean).length;
}
