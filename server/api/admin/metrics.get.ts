import { defineEventHandler } from 'h3';
import { loadEnv } from '../../../src/config/env';
import { buildPlatformAdminMetrics } from '../../../src/services/platformAdminService';
import { getAppDatabase, requirePlatformAdmin } from '../../utils/app';

export default defineEventHandler((event) => {
  requirePlatformAdmin(event);
  const env = loadEnv();
  const metrics = buildPlatformAdminMetrics(getAppDatabase(), env.billingPlans);
  return {
    ...metrics,
    worker: {
      ...metrics.worker,
      sourceRuns: metrics.worker.sourceRuns.map((run) => ({ ...run, scopeKey: 'aggregate' })),
    },
  };
});
