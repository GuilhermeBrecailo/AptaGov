import { createError, defineEventHandler, getRouterParam } from 'h3';
import type { SqliteDatabase } from '../../../../../../src/db/database';
import { OpportunityChangeRepository } from '../../../../../../src/repositories/opportunityChangeRepository';
import { OpportunityChangeService } from '../../../../../../src/services/opportunityChangeService';
import { getAppDatabase, requireActiveBilling } from '../../../../../utils/app';

export async function handleOpportunityChangeRead(input: {
  service?: OpportunityChangeService;
  db: SqliteDatabase;
  organizationId: number;
  opportunityId: number;
  changeId: number;
}) {
  if (!Number.isInteger(input.opportunityId) || !Number.isInteger(input.changeId)) {
    throw createError({ statusCode: 400, statusMessage: 'Mudança inválida' });
  }
  const service = input.service ?? new OpportunityChangeService(new OpportunityChangeRepository(input.db));
  const change = service.markRead(input.organizationId, input.opportunityId, input.changeId);
  if (!change) throw createError({ statusCode: 404, statusMessage: 'Mudança não encontrada' });
  return change;
}

export default defineEventHandler((event) => {
  const context = requireActiveBilling(event, 'kanban');
  return handleOpportunityChangeRead({
    db: getAppDatabase(),
    organizationId: context.organization.id,
    opportunityId: Number(getRouterParam(event, 'id')),
    changeId: Number(getRouterParam(event, 'changeId')),
  });
});
