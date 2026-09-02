import { defineEventHandler } from 'h3';
import { loadEnv } from '../../src/config/env';
import { buildSourceHealthMetrics } from '../../src/services/platformAdminService';
import { getAppDatabase, requirePlatformAdmin } from '../utils/app';

export default defineEventHandler((event) => {
  requirePlatformAdmin(event);
  return buildSourceHealthMetrics(getAppDatabase(), loadEnv());
});
