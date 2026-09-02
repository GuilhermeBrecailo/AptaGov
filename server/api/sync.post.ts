import { createError, defineEventHandler, readBody } from 'h3';
import { getRuntime, requireActiveBilling } from '../utils/app';

export default defineEventHandler(async (event) => {
  const context = requireActiveBilling(event, 'catalog');
  const body = await readBody<{ radarId?: unknown }>(event).catch(() => ({ radarId: undefined as unknown }));
  const radarId = body && typeof body.radarId === 'number' && Number.isInteger(body.radarId) ? body.radarId : undefined;
  const runtime = getRuntime();
  if (radarId !== undefined && !runtime.manualRadarBelongsToOrganization(context.organization.id, radarId)) {
    throw createError({ statusCode: 404, statusMessage: 'Radar não encontrado para esta organização' });
  }
  try {
    return await runtime.runCycle({ mode: 'manual', organizationId: context.organization.id, radarId });
  } catch (error) {
    throw createError({ statusCode: 503, statusMessage: error instanceof Error ? error.message : 'Sincronização pausada' });
  }
});
