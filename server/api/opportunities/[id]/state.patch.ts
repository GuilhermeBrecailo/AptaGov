import { createError, defineEventHandler, getRouterParam, readBody } from 'h3';
import { VALID_TRANSITIONS, type KanbanState } from '../../../../src/domain/types';
import { transitionOrganizationOpportunity } from '../../../../src/services/opportunityService';
import { getRuntime, requireActiveBilling } from '../../../utils/app';

export default defineEventHandler(async (event) => {
  const context = requireActiveBilling(event, 'kanban');
  const id = Number(getRouterParam(event, 'id'));
  const body = await readBody<{ state?: string }>(event);
  const nextState = body.state as KanbanState | undefined;
  if (!Number.isInteger(id) || !nextState || !Object.hasOwn(VALID_TRANSITIONS, nextState)) {
    throw createError({ statusCode: 400, statusMessage: 'Estado inválido' });
  }

  try {
    const runtime = getRuntime();
    const opportunity = runtime.opportunities.findById(id);
    const currentState = opportunity ? runtime.opportunities.findOrganizationState(context.organization.id, id) : undefined;
    if (!opportunity || !currentState || !VALID_TRANSITIONS[currentState].includes(nextState)) {
      throw createError({ statusCode: 422, statusMessage: 'Transição de estado inválida' });
    }
    transitionOrganizationOpportunity(runtime.opportunities, context.organization.id, id, nextState);
    return runtime.opportunities.listCatalog({ organizationId: context.organization.id, q: opportunity.title, pageSize: 50 }).data.find((item) => item.id === id);
  } catch (error) {
    if (error && typeof error === 'object' && 'statusCode' in error) throw error;
    throw createError({ statusCode: 500, statusMessage: 'Não foi possível atualizar a oportunidade' });
  }
});
