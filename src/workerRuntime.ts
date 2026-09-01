import { loadEnv, type AppEnv } from './config/env';
import { loadFilters } from './config/filters';
import { createDatabase, type SqliteDatabase } from './db/database';
import { PncpClient } from './integrations/pncp/PncpClient';
import { OpenDataClient } from './integrations/pncp/OpenDataClient';
import { JobRepository } from './repositories/jobRepository';
import { OpportunityRepository } from './repositories/opportunityRepository';
import { OrganizationFilterRepository } from './repositories/organizationFilterRepository';
import { OrganizationRepository } from './repositories/organizationRepository';
import { SystemStateRepository } from './repositories/systemStateRepository';
import { createDatabaseBackup } from './services/backupService';
import { classifyOpportunities, classifyOrganizationOpportunities } from './services/scoring/classificationService';
import { syncFromPncp } from './services/syncService';
import { NotificationService } from './services/notificationService';
import { ResendEmailNotifier } from './integrations/notifications/ResendEmailNotifier';
import { PushNotificationService } from './services/pushNotificationService';
import { WebPushNotifier } from './integrations/notifications/WebPushNotifier';
import { BillingService } from './services/billingService';
import { NotificationBudgetRepository } from './repositories/notificationBudgetRepository';
import { logger } from './observability/logger';
import { OrganizationSyncSettingsRepository } from './repositories/organizationSyncSettingsRepository';
import { shouldRunSync, type SyncMode } from './services/syncPolicy';
import { SavedSearchRepository } from './repositories/savedSearchRepository';
import { runSelectedRadars } from './services/radarSyncService';
import { selectRadarsForRun } from './services/savedSearchService';

export interface WorkerCycleResult {
  paused: boolean;
  reason?: string | null;
  synced: number;
  classified: number;
  notified: number;
}

export interface WorkerCycleOptions {
  mode?: SyncMode;
  organizationId?: number;
  radarId?: number;
}

export class WorkerRuntime {
  readonly opportunities: OpportunityRepository;
  readonly jobs: JobRepository;
  readonly systemState: SystemStateRepository;
  private readonly pncp: PncpClient;
  private readonly openData: OpenDataClient;
  private readonly db: SqliteDatabase;
  readonly notifications: NotificationService;
  readonly pushNotifications: PushNotificationService;
  readonly billing: BillingService;
  readonly syncSettings: OrganizationSyncSettingsRepository;

  constructor(private readonly env: AppEnv = loadEnv(), db?: SqliteDatabase) {
    this.db = db ?? createDatabase(env.databaseUrl);
    this.opportunities = new OpportunityRepository(this.db);
    this.jobs = new JobRepository(this.db);
    this.systemState = new SystemStateRepository(this.db);
    this.notifications = new NotificationService(this.db);
    this.pushNotifications = new PushNotificationService(this.db);
    this.billing = new BillingService(this.db, { trialDays: env.billingTrialDays });
    this.syncSettings = new OrganizationSyncSettingsRepository(this.db);
    this.pncp = new PncpClient({ baseUrl: env.pncpBaseUrl, timeoutMs: env.pncpTimeoutMs, maxRetries: env.pncpMaxRetries });
    this.openData = new OpenDataClient({ baseUrl: env.openDataBaseUrl, timeoutMs: env.pncpTimeoutMs, maxRetries: env.pncpMaxRetries });
  }

  async runCycle(options: WorkerCycleOptions = {}): Promise<WorkerCycleResult> {
    const paused = this.systemState.status();
    if (paused.paused) {
      return { paused: true, reason: paused.reason, synced: 0, classified: 0, notified: 0 };
    }
    const mode = options.mode ?? 'automatic';
    const enabledOrganizationIds = this.syncSettings.listEnabledOrganizationIds();
    if (!shouldRunSync(mode, enabledOrganizationIds.length > 0)) {
      return { paused: false, synced: 0, classified: 0, notified: 0 };
    }
    const cycleStartedAt = new Date().toISOString();
    this.jobs.recoverInterrupted();
    const jobId = this.jobs.create('sync_and_classify');
    this.jobs.markRunning(jobId);
    let phase = 'sync';
    try {
      const defaultFilters = loadFilters();
      const organizationFilters = new OrganizationFilterRepository(this.db);
      const savedSearches = new SavedSearchRepository(this.db);
      const organizations = new OrganizationRepository(this.db).listAll()
        .filter((organization) => options.organizationId === undefined || organization.id === options.organizationId)
        .filter((organization) => mode === 'manual' || enabledOrganizationIds.includes(organization.id));
      const syncResult = { received: 0, created: 0, updated: 0 };
      for (const organization of organizations) {
        const radars = savedSearches.list(organization.id);
        if (radars.length > 0) {
          const result = await runSelectedRadars(
            radars,
            mode,
            options.radarId,
            (radar) => syncFromPncp([this.pncp, this.openData], this.opportunities, radar.filters),
            (radar, runAt, lastMatchAt) => savedSearches.markRun(organization.id, radar.id, runAt, lastMatchAt),
          );
          syncResult.received += result.received;
          syncResult.created += result.created;
          syncResult.updated += result.updated;
          continue;
        }
        const filters = organizationFilters.find(organization.id) ?? defaultFilters;
        const result = await syncFromPncp([this.pncp, this.openData], this.opportunities, filters);
        syncResult.received += result.received;
        syncResult.created += result.created;
        syncResult.updated += result.updated;
      }
      phase = 'classification';
      const classification = await classifyOpportunities(this.opportunities, defaultFilters);
      let organizationClassified = 0;
      for (const organization of new OrganizationRepository(this.db).listAll()) {
        const currentFilters = organizationFilters.find(organization.id) ?? organizationFilters.save(organization.id, defaultFilters);
        const result = await classifyOrganizationOpportunities(this.opportunities, organization.id, currentFilters, { onlyUnclassified: true });
        organizationClassified += result.classified;
      }
      phase = 'notifications';
      const notificationWindow = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      let notificationBudget = Math.max(0, this.env.maxNotificationsPerHour - new NotificationBudgetRepository(this.db).countCreatedSince(notificationWindow));
      const notificationOrganizationIds = mode === 'manual' && options.organizationId !== undefined
        ? [options.organizationId]
        : enabledOrganizationIds;
      for (const organizationId of notificationOrganizationIds) {
        if (notificationBudget <= 0 || !this.billing.canUse(organizationId, 'notifications')) continue;
        const radars = savedSearches.list(organizationId);
        const selectedRadars = selectRadarsForRun(radars, mode, options.radarId);
        if (radars.length === 0) {
          const currentFilters = organizationFilters.find(organizationId) ?? defaultFilters;
          notificationBudget -= this.notifications.queueRecent(organizationId, cycleStartedAt, currentFilters.minimumScore, notificationBudget);
          continue;
        }
        for (const radar of selectedRadars) {
          if (notificationBudget <= 0) break;
          notificationBudget -= this.notifications.queueRecentForRadar(organizationId, radar.filters, cycleStartedAt, notificationBudget);
        }
      }
      const deadlineFrom = new Date().toISOString();
      const deadlineTo = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
      for (const organizationId of notificationOrganizationIds) {
        if (notificationBudget <= 0 || !this.billing.canUse(organizationId, 'notifications')) continue;
        const queued = this.notifications.queueUpcomingDeadlines(organizationId, deadlineFrom, deadlineTo, notificationBudget);
        notificationBudget -= queued;
      }
      notificationBudget -= this.pushNotifications.queueRecent(
        cycleStartedAt,
        notificationBudget,
        mode === 'automatic' ? { automaticOnly: true } : { organizationId: options.organizationId },
      );
      for (const organizationId of notificationOrganizationIds) {
        if (notificationBudget <= 0 || !this.billing.canUse(organizationId, 'notifications')) continue;
        const queued = this.pushNotifications.queueUpcomingDeadlines(organizationId, deadlineFrom, deadlineTo, notificationBudget);
        notificationBudget -= queued;
      }
      let notified = 0;
      if (this.notifications.pendingCount() > 0) {
        notified = await this.notifications.deliverPending(new ResendEmailNotifier(this.env.resendApiKey, this.env.notificationEmailFrom));
      }
      if (this.pushNotifications.pendingCount() > 0) {
        notified += await this.pushNotifications.deliverPending(new WebPushNotifier(this.env.vapidSubject, this.env.vapidPublicKey, this.env.vapidPrivateKey));
      }
      phase = 'backup';
      createDatabaseBackup(this.db, this.env.databaseUrl);
      this.jobs.markCompleted(jobId);
      logger.info({ sync: syncResult, classification: { global: classification.classified, organizations: organizationClassified }, notified }, 'Worker cycle completed');
      return { paused: false, synced: syncResult.received, classified: classification.classified + organizationClassified, notified };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown worker error';
      this.jobs.markFailed(jobId, message);
      const reason = phase === 'sync' ? 'sync_error' : phase === 'notifications' ? 'notification_channel_down' : 'worker_error';
      this.systemState.pause(reason, { phase, error: message });
      logger.error({ phase, error: message }, 'Worker cycle paused after error');
      throw error;
    }
  }

  close(): void {
    this.db.close();
  }
}
