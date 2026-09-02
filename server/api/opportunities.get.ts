import { createError, defineEventHandler, getQuery } from 'h3';
import type { CatalogQuery, OpportunityRepository } from '../../src/repositories/opportunityRepository';
import { getRuntime, getSavedSearchService, requireActiveBilling } from '../utils/app';

export function handleOpportunitiesGet(input: {
  opportunities: OpportunityRepository;
  organizationId: number;
  query: Record<string, unknown>;
  radarFilters?: CatalogQuery['radarFilters'];
}) {
  const query = input.query;
  const opportunityId = integerValue(query.opportunityId);
  if (opportunityId !== undefined) {
    return input.opportunities.listCatalog({
      organizationId: input.organizationId,
      opportunityId,
      page: 1,
      pageSize: 1,
      authorizedOnly: true,
      hideNotRelevant: false,
      sort: stringValue(query.sort) as 'score' | 'deadline' | 'publication' | undefined,
    });
  }

  return input.opportunities.listCatalog({
    organizationId: input.organizationId,
    q: stringValue(query.q),
    minScore: numberValue(query.minScore),
    state: stringValue(query.state),
    page: numberValue(query.page),
    pageSize: numberValue(query.pageSize),
    kanbanOnly: stringValue(query.kanbanOnly) === 'true',
    feedback: stringValue(query.feedback) as 'favorite' | 'not_relevant' | undefined,
    hideNotRelevant: stringValue(query.hideNotRelevant) !== 'false',
    radarFilters: input.radarFilters,
    openDeadlineOnly: stringValue(query.openDeadlineOnly) === 'true',
    sort: stringValue(query.sort) as 'score' | 'deadline' | 'publication' | undefined,
  });
}

export default defineEventHandler((event) => {
  const context = requireActiveBilling(event, 'catalog');
  const query = getQuery(event) as Record<string, unknown>;
  const radarId = numberValue(query.radarId);
  const radar = radarId === undefined ? undefined : getSavedSearchService().get(context.organization.id, radarId);
  if (radarId !== undefined && !radar) throw createError({ statusCode: 404, statusMessage: 'Radar não encontrado' });
  return handleOpportunitiesGet({
    opportunities: getRuntime().opportunities,
    organizationId: context.organization.id,
    query: {
      ...query,
      minScore: numberValue(query.minScore) ?? radar?.filters.minimumScore,
    },
    radarFilters: radar?.filters,
  });
});

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
  const parsed = Number(value);
  return value !== undefined && Number.isFinite(parsed) ? parsed : undefined;
}

function integerValue(value: unknown): number | undefined {
  const parsed = numberValue(value);
  return parsed !== undefined && Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}
