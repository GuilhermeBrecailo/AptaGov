import { loadEnv } from './config/env';
import { WorkerRuntime } from './workerRuntime';
import { WorkerScheduler } from './workerScheduler';
import { logger } from './observability/logger';

const env = loadEnv();
const runtime = new WorkerRuntime(env);
const scheduler = new WorkerScheduler({
  intervalMs: env.syncIntervalMinutes * 60_000,
  run: () => runtime.runCycle({ mode: 'automatic' }),
});

const stop = () => {
  scheduler.stop();
  runtime.close();
};
process.once('SIGINT', stop);
process.once('SIGTERM', stop);

logger.info({ intervalMinutes: env.syncIntervalMinutes, firstRun: 'immediate' }, 'Automatic PNCP scheduler started');
scheduler.start();
