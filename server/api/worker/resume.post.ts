import { createError, defineEventHandler } from 'h3';
import { isOrganizationOwner } from '../../../src/auth/authorization';
import { getRuntime, requireAuth } from '../../utils/app';

export default defineEventHandler(async (event) => {
  const context = requireAuth(event);
  if (!isOrganizationOwner(context)) throw createError({ statusCode: 403, statusMessage: 'Somente o proprietÃ¡rio pode retomar o worker' });
  const runtime = getRuntime();
  if (!await runtime.resumeAfterHealthCheck()) {
    throw createError({ statusCode: 503, statusMessage: 'As fontes oficiais ainda nao passaram no health check' });
  }
  return runtime.systemState.status();
});
