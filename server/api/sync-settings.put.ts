import { createError, defineEventHandler, readBody } from 'h3';
import { isOrganizationOwner } from '../../src/auth/authorization';
import { loadEnv } from '../../src/config/env';
import { OrganizationSyncSettingsRepository } from '../../src/repositories/organizationSyncSettingsRepository';
import { getAppDatabase, requireActiveBilling } from '../utils/app';
import { z } from 'zod';

const syncSettingsSchema = z.object({ enabled: z.boolean() });

export default defineEventHandler(async (event) => {
  const context = requireActiveBilling(event, 'catalog');
  if (!isOrganizationOwner(context)) throw createError({ statusCode: 403, statusMessage: 'Somente o proprietário pode alterar a busca automática' });
  const parsed = syncSettingsSchema.safeParse(await readBody(event));
  if (!parsed.success) throw createError({ statusCode: 400, statusMessage: 'Preferência de busca automática inválida' });
  const settings = new OrganizationSyncSettingsRepository(getAppDatabase()).save(context.organization.id, parsed.data.enabled);
  return { ...settings, intervalMinutes: loadEnv().syncIntervalMinutes };
});
