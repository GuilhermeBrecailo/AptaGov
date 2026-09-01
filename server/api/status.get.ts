import { defineEventHandler } from 'h3';
import { loadEnv } from '../../src/config/env';
import { OrganizationSyncSettingsRepository } from '../../src/repositories/organizationSyncSettingsRepository';
import { getAppDatabase, getRuntime, requireAuth } from '../utils/app';

export default defineEventHandler((event) => {
  const context = requireAuth(event);
  const runtime = getRuntime();
  const notificationSettings = runtime.notifications.settings(context.organization.id);
  const syncSettings = new OrganizationSyncSettingsRepository(getAppDatabase());
  return {
    pause: runtime.systemState.status(),
    opportunities: runtime.opportunities.count(),
    automaticSync: {
      enabled: syncSettings.isEnabled(context.organization.id),
      intervalMinutes: loadEnv().syncIntervalMinutes,
    },
    notifications: {
      enabled: notificationSettings?.enabled ?? false,
      pending: runtime.notifications.pendingCount(context.organization.id),
    },
  };
});
