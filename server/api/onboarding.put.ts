import { createError, defineEventHandler, readBody } from 'h3';
import { filterConfigSchema } from '../../src/config/filters';
import { completeOnboarding } from '../../src/services/onboardingService';
import { getAppDatabase, requireActiveBilling } from '../utils/app';

export default defineEventHandler(async (event) => {
  const context = requireActiveBilling(event, 'catalog');
  const body = await readBody<{ radarName?: unknown; filters?: unknown; automaticSyncEnabled?: unknown; notificationsEnabled?: unknown; notificationEmail?: unknown }>(event);
  const filters = filterConfigSchema.safeParse(body.filters);
  if (!filters.success || typeof body.radarName !== 'string' || typeof body.automaticSyncEnabled !== 'boolean' || typeof body.notificationsEnabled !== 'boolean' || typeof body.notificationEmail !== 'string') {
    throw createError({ statusCode: 400, statusMessage: 'Complete as informações do primeiro radar' });
  }
  try {
    return completeOnboarding(getAppDatabase(), context.organization.id, {
      radarName: body.radarName,
      filters: filters.data,
      automaticSyncEnabled: body.automaticSyncEnabled,
      notificationsEnabled: body.notificationsEnabled,
      notificationEmail: body.notificationEmail,
    });
  } catch (error) {
    throw createError({ statusCode: 400, statusMessage: error instanceof Error ? error.message : 'Não foi possível concluir o onboarding' });
  }
});
