import { createError, defineEventHandler, getRouterParam } from 'h3';
import { ChecklistRepository } from '../../../../src/repositories/checklistRepository';
import { ChecklistService } from '../../../../src/services/checklistService';
import { OpportunityRepository } from '../../../../src/repositories/opportunityRepository';
import type { SqliteDatabase } from '../../../../src/db/database';
import { getAppDatabase, getRuntime, requireActiveBilling } from '../../../utils/app';

export function handleOpportunityChecklistGet(input: {
  service?: ChecklistService;
  opportunities?: OpportunityRepository;
  db: SqliteDatabase;
  organizationId: number;
  opportunityId: number;
}): ReturnType<ChecklistService['ensureDefaults']> {
  const opportunityId = input.opportunityId;
  if (!Number.isInteger(opportunityId)) {
    throw createError({ statusCode: 400, message: 'Licitação inválida' });
  }

  const opportunities = input.opportunities ?? new OpportunityRepository(input.db);
  if (!opportunities.findById(opportunityId) || !opportunities.findOrganizationState(input.organizationId, opportunityId)) {
    throw createError({ statusCode: 404, message: 'Checklist não encontrado' });
  }

  return (input.service ?? new ChecklistService(new ChecklistRepository(input.db)))
    .ensureDefaults(input.organizationId, opportunityId);
}

export default defineEventHandler((event) => {
  const context = requireActiveBilling(event, 'kanban');
  const opportunityId = Number(getRouterParam(event, 'id'));
  const runtime = getRuntime();
  return handleOpportunityChecklistGet({
    db: getAppDatabase(),
    opportunities: runtime.opportunities,
    organizationId: context.organization.id,
    opportunityId,
  });
});
