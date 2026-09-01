import { createError, defineEventHandler } from 'h3';
import { getRuntime, requireActiveBilling } from '../utils/app';

export default defineEventHandler(async (event) => {
  const context = requireActiveBilling(event, 'catalog');
  try {
    return await getRuntime().runCycle({ mode: 'manual', organizationId: context.organization.id });
  } catch (error) {
    throw createError({ statusCode: 503, statusMessage: error instanceof Error ? error.message : 'Sincronização pausada' });
  }
});
