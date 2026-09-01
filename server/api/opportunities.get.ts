import { createError, defineEventHandler, getQuery } from 'h3';
import { getRuntime, getSavedSearchService, requireActiveBilling } from '../utils/app';

export default defineEventHandler((event) => {
  const context = requireActiveBilling(event, 'catalog');
  const query = getQuery(event);
  const radarId = numberValue(query.radarId);
  const radar = radarId === undefined ? undefined : getSavedSearchService().get(context.organization.id, radarId);
  if (radarId !== undefined && !radar) throw createError({ statusCode: 404, statusMessage: 'Radar não encontrado' });
  return getRuntime().opportunities.listCatalog({
    organizationId: context.organization.id,
    q: stringValue(query.q),
    minScore: numberValue(query.minScore) ?? radar?.filters.minimumScore,
    state: stringValue(query.state),
    page: numberValue(query.page),
    pageSize: numberValue(query.pageSize),
    kanbanOnly: stringValue(query.kanbanOnly) === 'true',
    feedback: stringValue(query.feedback) as 'favorite' | 'not_relevant' | undefined,
    hideNotRelevant: stringValue(query.hideNotRelevant) !== 'false',
    radarFilters: radar?.filters,
    openDeadlineOnly: stringValue(query.openDeadlineOnly) === 'true',
    sort: stringValue(query.sort) as 'score' | 'deadline' | 'publication' | undefined,
  });
});

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
  const parsed = Number(value);
  return value !== undefined && Number.isFinite(parsed) ? parsed : undefined;
}
