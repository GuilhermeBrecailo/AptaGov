import { describe, expect, it } from 'vitest';
import { scoreOpportunity } from '../../src/services/scoring/ruleScorer';

describe('scoreOpportunity', () => {
  it('pontua palavras-chave e aplica exclusão antes de classificar', () => {
    const result = scoreOpportunity(
      {
        title: 'Sistema de gestão e desenvolvimento de software',
        description: 'Contratação para tecnologia em órgão de SP',
        state: 'SP',
        estimatedValueCents: 100_000,
        deadline: new Date(Date.now() + 10 * 86_400_000).toISOString(),
      },
      {
        keywords: ['software', 'sistema'],
        excludedKeywords: ['obra'],
        states: ['SP'],
        estimatedValueMinCents: 0,
        scoreWeights: { keyword: 50, region: 20, value: 10, deadline: 20 },
      },
    );

    expect(result.score).toBeGreaterThanOrEqual(70);
    expect(result.reasons).toContain('Palavras-chave aderentes: software, sistema');
  });
});
