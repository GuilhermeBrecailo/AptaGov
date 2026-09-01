import { defineEventHandler } from 'h3';
import { loadEnv } from '../../src/config/env';
import { OrganizationSyncSettingsRepository } from '../../src/repositories/organizationSyncSettingsRepository';
import { getAppDatabase, requireActiveBilling } from '../utils/app';

export default defineEventHandler((event) => {
  const context = requireActiveBilling(event, 'catalog');
  const settings = new OrganizationSyncSettingsRepository(getAppDatabase());
  return {
    enabled: settings.isEnabled(context.organization.id),
    intervalMinutes: loadEnv().syncIntervalMinutes,
  };
});
