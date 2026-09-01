import { createError, defineEventHandler, readBody } from 'h3';
import { z } from 'zod';
import { loadEnv } from '../../src/config/env';
import { getRuntime, requireActiveBilling } from '../utils/app';

const pushSubscriptionSchema = z.object({
  endpoint: z.string().url().max(2048),
  expirationTime: z.number().int().nonnegative().nullable().optional(),
  keys: z.object({
    p256dh: z.string().min(1).max(256),
    auth: z.string().min(1).max(256),
  }),
});

export default defineEventHandler(async (event) => {
  const context = requireActiveBilling(event, 'notifications');
  const env = loadEnv();
  const runtime = getRuntime();
  if (!runtime.pushNotifications.isConfigured(env.vapidSubject, env.vapidPublicKey, env.vapidPrivateKey)) {
    throw createError({ statusCode: 503, statusMessage: 'Notificações do dispositivo ainda não estão configuradas' });
  }
  const parsed = pushSubscriptionSchema.safeParse(await readBody(event));
  if (!parsed.success) throw createError({ statusCode: 400, statusMessage: 'Assinatura de notificação inválida' });
  runtime.pushNotifications.registerSubscription(context.user.id, parsed.data);
  return { enabled: true };
});
