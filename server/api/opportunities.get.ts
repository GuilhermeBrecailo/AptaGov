import { createError, defineEventHandler, getQuery } from 'h3';
import type { CatalogQuery, OpportunityRepository, SituationFilter } from '../../src/repositories/opportunityRepository';
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
      situationFilter: 'all',
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
    situationFilter: situationValue(query),
    modalities: listValue(query.modalities),
    city: stringValue(query.city),
    disputeModes: listValue(query.disputeModes),
    publishedFrom: dateValue(query.publishedFrom),
    publishedTo: dateValue(query.publishedTo),
    deadlineFrom: dateValue(query.deadlineFrom),
    deadlineTo: dateValue(query.deadlineTo),
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

export function situationValue(query: Record<string, unknown>): SituationFilter {
  const text = stringValue(query.situation);
  if (text === 'open' || text === 'suspended' || text === 'cancelled' || text === 'all') return text;
  // Kanban e listas de feedback mostram o que a organização já acompanha, sem esconder encerradas.
  if (text === undefined && (stringValue(query.kanbanOnly) === 'true' || stringValue(query.feedback))) return 'all';
  return 'open';
}

function listValue(value: unknown): string[] | undefined {
  const text = Array.isArray(value) ? value.filter((item) => typeof item === 'string').join(',') : stringValue(value);
  const items = text?.split(',').map((item) => item.trim()).filter(Boolean);
  return items && items.length > 0 ? items : undefined;
}

function dateValue(value: unknown): string | undefined {
  const text = stringValue(value);
  return text && /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : undefined;
}

function integerValue(value: unknown): number | undefined {
  const parsed = numberValue(value);
  return parsed !== undefined && Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}
