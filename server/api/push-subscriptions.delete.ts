import { createError, defineEventHandler, readBody } from 'h3';
import { z } from 'zod';
import { getRuntime, requireAuth } from '../utils/app';

const endpointSchema = z.object({ endpoint: z.string().url().max(2048) });

export default defineEventHandler(async (event) => {
  const context = requireAuth(event);
  const parsed = endpointSchema.safeParse(await readBody(event));
  if (!parsed.success) throw createError({ statusCode: 400, statusMessage: 'Endpoint de notificação inválido' });
  getRuntime().pushNotifications.removeSubscription(context.user.id, parsed.data.endpoint);
  return { enabled: false };
});
