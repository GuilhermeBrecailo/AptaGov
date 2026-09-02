import { defineEventHandler, getQuery } from 'h3';
import type { SqliteDatabase } from '../../../src/db/database';
import { OpportunityChangeRepository } from '../../../src/repositories/opportunityChangeRepository';
import { OpportunityChangeService } from '../../../src/services/opportunityChangeService';
import { getAppDatabase, requireActiveBilling } from '../../utils/app';

export function handleOpportunityChangesListGet(input: {
  service?: OpportunityChangeService;
  db: SqliteDatabase;
  organizationId: number;
  query: { unreadOnly?: unknown };
}) {
  const unreadOnly = input.query.unreadOnly === true
    || input.query.unreadOnly === 'true'
    || input.query.unreadOnly === '1';
  return (input.service ?? new OpportunityChangeService(new OpportunityChangeRepository(input.db)))
    .listAllForOrganization(input.organizationId, unreadOnly);
}

export default defineEventHandler((event) => {
  const context = requireActiveBilling(event, 'kanban');
  return handleOpportunityChangesListGet({
    db: getAppDatabase(),
    organizationId: context.organization.id,
    query: getQuery(event),
  });
});
