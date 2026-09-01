import { createError, defineEventHandler, getRouterParam, readBody } from 'h3';
import { OpportunityFeedbackRepository, type OpportunityFeedbackStatus } from '../../../../src/repositories/opportunityFeedbackRepository';
import { getAppDatabase, getRuntime, requireActiveBilling } from '../../../utils/app';

export default defineEventHandler(async (event) => {
  const context = requireActiveBilling(event, 'catalog');
  const opportunityId = Number(getRouterParam(event, 'id'));
  if (!Number.isInteger(opportunityId) || opportunityId < 1 || !getRuntime().opportunities.findById(opportunityId)) {
    throw createError({ statusCode: 404, statusMessage: 'Licitação não encontrada' });
  }
  const body = await readBody<{ status?: unknown }>(event);
  const status = body.status;
  const feedback = new OpportunityFeedbackRepository(getAppDatabase());
  if (status === null || status === undefined) {
    feedback.clear(context.organization.id, opportunityId);
    return { status: null };
  }
  if (status !== 'FAVORITED' && status !== 'NOT_RELEVANT') {
    throw createError({ statusCode: 400, statusMessage: 'Ação de oportunidade inválida' });
  }
  return { status: feedback.save(context.organization.id, opportunityId, status as OpportunityFeedbackStatus).status };
});
