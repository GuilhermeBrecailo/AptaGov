import type { ScoreResult } from '../../domain/types';

export interface RuleScoringInput {
  title: string;
  description: string;
  state: string;
  estimatedValueCents: number;
  deadline?: string | null;
}

export interface RuleScoringFilters {
  keywords: string[];
  excludedKeywords: string[];
  states: string[];
  estimatedValueMinCents: number;
  scoreWeights: {
    keyword: number;
    region: number;
    value: number;
    deadline: number;
  };
}

export function scoreOpportunity(input: RuleScoringInput, filters: RuleScoringFilters): ScoreResult {
  const text = normalize(`${input.title} ${input.description}`);
  const excludedKeyword = filters.excludedKeywords.find((keyword) => text.includes(normalize(keyword)));
  if (excludedKeyword) {
    return {
      score: 0,
      breakdown: { keyword: 0, region: 0, value: 0, deadline: 0 },
      reasons: [`Excluída por palavra-chave: ${excludedKeyword}`],
      excluded: true,
    };
  }

  const matchedKeywords = filters.keywords.filter((keyword) => text.includes(normalize(keyword)));
  const keywordScore = filters.keywords.length === 0
    ? filters.scoreWeights.keyword
    : Math.round(filters.scoreWeights.keyword * matchedKeywords.length / filters.keywords.length);
  const regionMatches = filters.states.length === 0 || filters.states.some((state) => normalize(state) === normalize(input.state));
  const regionScore = regionMatches ? filters.scoreWeights.region : 0;
  const valueScore = input.estimatedValueCents >= filters.estimatedValueMinCents ? filters.scoreWeights.value : 0;
  const deadlineScore = isFuture(input.deadline) ? filters.scoreWeights.deadline : 0;
  const reasons: string[] = [];
  if (matchedKeywords.length > 0) {
    reasons.push(`Palavras-chave aderentes: ${matchedKeywords.join(', ')}`);
  }
  if (regionMatches && filters.states.length > 0) {
    reasons.push(`Região aderente: ${input.state}`);
  }
  if (valueScore > 0) {
    reasons.push('Valor estimado dentro do filtro');
  }
  if (deadlineScore > 0) {
    reasons.push('Prazo ainda aberto');
  }

  return {
    score: Math.max(0, Math.min(100, keywordScore + regionScore + valueScore + deadlineScore)),
    breakdown: { keyword: keywordScore, region: regionScore, value: valueScore, deadline: deadlineScore },
    reasons,
    excluded: false,
  };
}

function normalize(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function isFuture(value: string | null | undefined): boolean {
  return value === null || value === undefined || new Date(value).getTime() > Date.now();
}
