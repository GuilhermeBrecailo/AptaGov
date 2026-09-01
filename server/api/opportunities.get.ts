import { defineEventHandler, getQuery } from 'h3';
import { getRuntime, requireActiveBilling } from '../utils/app';

export default defineEventHandler((event) => {
  const context = requireActiveBilling(event, 'catalog');
  const query = getQuery(event);
  return getRuntime().opportunities.listCatalog({
    organizationId: context.organization.id,
    q: stringValue(query.q),
    minScore: numberValue(query.minScore),
    state: stringValue(query.state),
    page: numberValue(query.page),
    pageSize: numberValue(query.pageSize),
    kanbanOnly: stringValue(query.kanbanOnly) === 'true',
  });
});

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
  const parsed = Number(value);
  return value !== undefined && Number.isFinite(parsed) ? parsed : undefined;
}
