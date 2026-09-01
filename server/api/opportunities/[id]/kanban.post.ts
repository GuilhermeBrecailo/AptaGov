import { createError, defineEventHandler, getRouterParam } from 'h3';
import { ChecklistRepository } from '../../../../src/repositories/checklistRepository';
import { ChecklistService } from '../../../../src/services/checklistService';
import { addOpportunityToKanban } from '../../../../src/services/opportunityService';
import { getAppDatabase, getRuntime, requireActiveBilling } from '../../../utils/app';

export default defineEventHandler((event) => {
  const context = requireActiveBilling(event, 'kanban');
  const id = Number(getRouterParam(event, 'id'));
  if (!Number.isInteger(id)) throw createError({ statusCode: 400, statusMessage: 'Licitação inválida' });
  const runtime = getRuntime();
  if (!runtime.opportunities.findById(id)) throw createError({ statusCode: 404, statusMessage: 'Licitação não encontrada' });
  addOpportunityToKanban(runtime.opportunities, new ChecklistService(new ChecklistRepository(getAppDatabase())), context.organization.id, id);
  return runtime.opportunities.listCatalog({ organizationId: context.organization.id, kanbanOnly: true, pageSize: 50 }).data.find((item) => item.id === id);
});
