import type { FilterConfig } from '../../domain/types';
import type { OpportunityRepository } from '../../repositories/opportunityRepository';
import { scoreOpportunity } from './ruleScorer';

export interface ClassificationResult {
  classified: number;
}

export async function classifyOpportunities(
  repository: OpportunityRepository,
  filters: FilterConfig,
): Promise<ClassificationResult> {
  let classified = 0;
  for (const opportunity of repository.listUnclassified()) {
    const result = scoreOpportunity(opportunity, filters);
    repository.updateClassification(opportunity.id, { score: result.score, breakdown: result.breakdown, source: 'rules' });
    classified += 1;
  }
  return { classified };
}

export async function classifyOrganizationOpportunities(
  repository: OpportunityRepository,
  organizationId: number,
  filters: FilterConfig,
  options: { onlyUnclassified?: boolean } = {},
): Promise<ClassificationResult> {
  let classified = 0;
  const opportunities = options.onlyUnclassified
    ? repository.listUnclassifiedForOrganization(organizationId)
    : repository.list();
  for (const opportunity of opportunities) {
    const result = scoreOpportunity(opportunity, filters);
    repository.updateOrganizationClassification(organizationId, opportunity.id, {
      score: result.score,
      breakdown: result.breakdown,
      source: 'rules',
    });
    classified += 1;
  }
  return { classified };
}
