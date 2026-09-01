import { defineEventHandler } from 'h3';
import { loadEnv } from '../../src/config/env';
import { getRuntime, requireActiveBilling } from '../utils/app';

export default defineEventHandler((event) => {
  requireActiveBilling(event, 'notifications');
  const env = loadEnv();
  const runtime = getRuntime();
  return {
    configured: runtime.pushNotifications.isConfigured(env.vapidSubject, env.vapidPublicKey, env.vapidPrivateKey),
    publicKey: env.vapidPublicKey,
  };
});
