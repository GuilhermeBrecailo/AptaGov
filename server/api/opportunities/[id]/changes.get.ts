import { createError, defineEventHandler, getQuery, getRouterParam } from 'h3';
import type { SqliteDatabase } from '../../../../src/db/database';
import { OpportunityChangeRepository } from '../../../../src/repositories/opportunityChangeRepository';
import { OpportunityChangeService } from '../../../../src/services/opportunityChangeService';
import { getAppDatabase, requireActiveBilling } from '../../../utils/app';

export function handleOpportunityChangesGet(input: {
  service?: OpportunityChangeService;
  db: SqliteDatabase;
  organizationId: number;
  opportunityId: number;
  query: { unreadOnly?: unknown };
}) {
  if (!Number.isInteger(input.opportunityId)) {
    throw createError({ statusCode: 400, statusMessage: 'Licitação inválida' });
  }
  const unreadOnly = input.query.unreadOnly === true
    || input.query.unreadOnly === 'true'
    || input.query.unreadOnly === '1';
  const service = input.service ?? new OpportunityChangeService(new OpportunityChangeRepository(input.db));
  return service.listForOrganization(input.organizationId, input.opportunityId, unreadOnly);
}

export default defineEventHandler((event) => {
  const context = requireActiveBilling(event, 'kanban');
  return handleOpportunityChangesGet({
    db: getAppDatabase(),
    organizationId: context.organization.id,
    opportunityId: Number(getRouterParam(event, 'id')),
    query: getQuery(event),
  });
});
