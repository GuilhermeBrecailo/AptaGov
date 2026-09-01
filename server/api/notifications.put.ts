import { createError, defineEventHandler, readBody } from 'h3';
import { z } from 'zod';
import { getRuntime, requireActiveBilling } from '../utils/app';

const notificationSchema = z.object({ enabled: z.boolean(), email: z.string().email() });

export default defineEventHandler(async (event) => {
  const context = requireActiveBilling(event, 'notifications');
  const parsed = notificationSchema.safeParse(await readBody(event));
  if (!parsed.success) throw createError({ statusCode: 400, statusMessage: 'Configuração de e-mail inválida' });
  return getRuntime().notifications.saveSettings(context.organization.id, parsed.data);
});
