import { loadEnv } from '../src/config/env';
import { loadFilters } from '../src/config/filters';
import { createDatabase } from '../src/db/database';
import { PncpClient } from '../src/integrations/pncp/PncpClient';
import { OpenDataClient } from '../src/integrations/pncp/OpenDataClient';
import { OpportunityRepository } from '../src/repositories/opportunityRepository';
import { classifyOpportunities } from '../src/services/scoring/classificationService';
import { createDatabaseBackup } from '../src/services/backupService';
import { syncFromPncp } from '../src/services/syncService';
import { NotificationService } from '../src/services/notificationService';
import { ResendEmailNotifier } from '../src/integrations/notifications/ResendEmailNotifier';
import { PushNotificationService } from '../src/services/pushNotificationService';
import { WebPushNotifier } from '../src/integrations/notifications/WebPushNotifier';

const env = loadEnv();
const filters = loadFilters();
const e2eFilters = { ...filters, lookbackDays: Math.min(filters.lookbackDays, 1) };
const db = createDatabase(env.databaseUrl);
const opportunities = new OpportunityRepository(db);
const notifications = new NotificationService(db);
const pushNotifications = new PushNotificationService(db);
const client = new PncpClient({ baseUrl: env.pncpBaseUrl, timeoutMs: env.pncpTimeoutMs, maxRetries: env.pncpMaxRetries });
const openData = new OpenDataClient({ baseUrl: env.openDataBaseUrl, timeoutMs: env.pncpTimeoutMs, maxRetries: env.pncpMaxRetries });

try {
  console.log('E2E real: consultando o PNCP...');
  const sync = await syncFromPncp([client, openData], opportunities, e2eFilters);
  const classification = await classifyOpportunities(opportunities, filters);
  const notificationSince = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const emailQueued = notifications.queueRecentForOrganizations(notificationSince, env.maxNotificationsPerHour);
  const pushQueued = pushNotifications.queueRecent(notificationSince, Math.max(0, env.maxNotificationsPerHour - emailQueued));
  let notified = 0;
  if (notifications.pendingCount() > 0) {
    notified += await notifications.deliverPending(new ResendEmailNotifier(env.resendApiKey, env.notificationEmailFrom));
  }
  if (pushNotifications.pendingCount() > 0) {
    notified += await pushNotifications.deliverPending(new WebPushNotifier(env.vapidSubject, env.vapidPublicKey, env.vapidPrivateKey));
  }
  console.log(`E2E real: ${sync.received} registros sincronizados (${sync.created} novos), ${classification.classified} classificados, ${emailQueued + pushQueued} notificações enfileiradas e ${notified} entregues.`);
  createDatabaseBackup(db, env.databaseUrl);
  console.log(`E2E real: fluxo concluido com ${opportunities.count()} oportunidades persistidas.`);
} catch (error) {
  console.error(`E2E real falhou: ${error instanceof Error ? error.message : 'erro desconhecido'}`);
  process.exitCode = 1;
} finally {
  db.close();
}
