import { createError, defineEventHandler, getRouterParam } from 'h3';
import type { EditalAnalysisService, EditalAnalysisView } from '../../../../src/services/edital/editalAnalysisService';
import { getEditalAnalysisService, requireActiveBilling } from '../../../utils/app';

export function handleEditalAnalysisPost(input: {
  service: EditalAnalysisService;
  organizationId: number;
  opportunityId: number;
}): EditalAnalysisView {
  if (!Number.isInteger(input.opportunityId)) {
    throw createError({ statusCode: 400, statusMessage: 'Licitação inválida' });
  }
  input.service.start(input.organizationId, input.opportunityId);
  return input.service.view(input.organizationId, input.opportunityId);
}

export default defineEventHandler((event) => {
  const context = requireActiveBilling(event, 'catalog');
  return handleEditalAnalysisPost({
    service: getEditalAnalysisService(),
    organizationId: context.organization.id,
    opportunityId: Number(getRouterParam(event, 'id'))
  });
});
