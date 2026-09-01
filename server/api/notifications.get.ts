import { defineEventHandler } from 'h3';
import { getRuntime, requireActiveBilling } from '../utils/app';

export default defineEventHandler((event) => {
  const context = requireActiveBilling(event, 'notifications');
  const runtime = getRuntime();
  const settings = runtime.notifications.settings(context.organization.id);
  return {
    enabled: settings?.enabled ?? false,
    email: settings?.email ?? context.user.email,
    pending: runtime.notifications.pendingCount(context.organization.id),
  };
});
