import { createError, defineEventHandler } from 'h3';
import { loadEnv } from '../../../src/config/env';
import { isPlatformAdminEmail } from '../../../src/auth/platformAdmin';
import { buildPlatformAdminMetrics } from '../../../src/services/platformAdminService';
import { getAppDatabase, requireAuth } from '../../utils/app';

export default defineEventHandler((event) => {
  const context = requireAuth(event);
  const env = loadEnv();
  if (!isPlatformAdminEmail(context.user.email, env.platformAdminEmails)) {
    throw createError({ statusCode: 403, statusMessage: 'Acesso restrito ao administrador da plataforma' });
  }
  return buildPlatformAdminMetrics(getAppDatabase(), env.billingPlans);
});
