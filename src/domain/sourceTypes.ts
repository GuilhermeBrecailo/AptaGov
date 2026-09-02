import type { FilterConfig, OpportunityInput } from './types';

export type SourceId = 'PNCP' | 'OPEN_DATA' | 'BEC/SP';
export type CanonicalSource = SourceId;

export const SOURCE_LABELS: Readonly<Record<SourceId, string>> = {
  PNCP: 'PNCP',
  OPEN_DATA: 'Dados Abertos',
  'BEC/SP': 'BEC/SP',
};

export function sourceLabel(source: SourceId): string {
  return SOURCE_LABELS[source];
}

export interface SourceWindow {
  dateFrom: string;
  dateTo: string;
}

export interface SourceQuery extends SourceWindow {
  filters: FilterConfig;
  cursor?: string | null;
}

export interface SourcePage<T> {
  items: T[];
  nextCursor: string | null;
  hasNext: boolean;
  fetchedAt: string;
}

export type MarketQuery = SourceQuery;

export interface MarketObservationInput {
  sourceCode?: SourceId;
  source?: SourceId;
  externalId: string;
  itemCode?: string | null;
  normalizedDescription: string;
  unit: string;
  quantity: number;
  unitPriceCents?: number | null;
  totalPriceCents?: number | null;
  organization?: string;
  state?: string;
  observedAt: string;
  sourceUrl: string;
  opportunityId?: number | null;
  raw?: unknown;
}

export interface MarketResultInput {
  sourceCode?: SourceId;
  source?: SourceId;
  externalId: string;
  itemCode?: string | null;
  normalizedDescription: string;
  unit: string;
  quantity: number;
  unitPriceCents?: number | null;
  totalPriceCents?: number | null;
  organization?: string;
  state?: string;
  opportunityId?: number | null;
  winner?: string | null;
  awardedPriceCents?: number | null;
  status?: string | null;
  observedAt: string;
  sourceUrl: string;
  raw?: unknown;
}

export type OfficialOpportunityInput = OpportunityInput;
