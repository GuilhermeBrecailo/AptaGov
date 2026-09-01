import { createError, readBody, defineEventHandler } from 'h3';
import { isOrganizationOwner } from '../../../src/auth/authorization';
import { getRuntime, requireAuth } from '../../utils/app';

export default defineEventHandler(async (event) => {
  const context = requireAuth(event);
  if (!isOrganizationOwner(context)) throw createError({ statusCode: 403, statusMessage: 'Somente o proprietÃ¡rio pode pausar o worker' });
  const body = await readBody<{ reason?: string }>(event);
  getRuntime().systemState.pause(body?.reason ?? 'manual_pause');
  return getRuntime().systemState.status();
});
