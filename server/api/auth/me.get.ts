import { defineEventHandler } from 'h3';
import { requireAuth } from '../../utils/app';
import { contextPayload } from '../../utils/authResponse';
import { loadEnv } from '../../../src/config/env';
import { isPlatformAdminEmail } from '../../../src/auth/platformAdmin';

export default defineEventHandler((event) => {
  const context = requireAuth(event);
  return contextPayload(context, isPlatformAdminEmail(context.user.email, loadEnv().platformAdminEmails));
});
