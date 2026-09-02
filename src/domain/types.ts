export type KanbanState =
  | 'NEW'
  | 'QUALIFIED'
  | 'CONTACTED'
  | 'IN_PROGRESS'
  | 'WON'
  | 'LOST'
  | 'DISCARDED';

export type ClassificationSource = 'rules';
import type { SourceId } from './sourceTypes';

export type OpportunitySource = SourceId;

export interface OpportunityInput {
  pncpId: string;
  source?: OpportunitySource;
  sourceCode?: SourceId;
  title: string;
  description: string;
  organization: string;
  state: string;
  city?: string;
  modality?: string;
  sourceUrl: string;
  publicationDate: string;
  biddingDeadline?: string | null;
  estimatedValueCents: number;
  raw?: unknown;
}

export interface Opportunity extends Omit<OpportunityInput, 'source' | 'sourceCode'> {
  id: number;
  source: OpportunitySource;
  sourceCode: SourceId;
  sourceLabel: string;
  city: string;
  modality: string;
  kanbanState: KanbanState;
  score: number;
  scoreBreakdown: Record<string, number>;
  classificationSource: ClassificationSource;
  createdAt: string;
  updatedAt: string;
}

export interface FilterConfig {
  lookbackDays: number;
  states: string[];
  citiesIbge: string[];
  modalities: string[];
  keywords: string[];
  excludedKeywords: string[];
  minimumScore: number;
  estimatedValueMinCents: number;
  scoreWeights: {
    keyword: number;
    region: number;
    value: number;
    deadline: number;
  };
}

export interface ScoreResult {
  score: number;
  breakdown: Record<string, number>;
  reasons: string[];
  excluded: boolean;
}

export const VALID_TRANSITIONS: Record<KanbanState, KanbanState[]> = {
  NEW: ['QUALIFIED', 'DISCARDED'],
  QUALIFIED: ['CONTACTED', 'DISCARDED'],
  CONTACTED: ['IN_PROGRESS', 'LOST', 'DISCARDED'],
  IN_PROGRESS: ['WON', 'LOST'],
  WON: [],
  LOST: [],
  DISCARDED: [],
};
