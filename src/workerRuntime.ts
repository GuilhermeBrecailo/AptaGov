import { loadEnv, type AppEnv } from './config/env';
import { loadFilters } from './config/filters';
import { createDatabase, type SqliteDatabase } from './db/database';
import type { FilterConfig } from './domain/types';
import type { SourceId } from './domain/sourceTypes';
import { createDefaultSourceRegistry } from './integrations/sources/sourceRegistry';
import type { PagedOfficialSourceClient } from './integrations/sources/OfficialSourceClient';
import { ResendEmailNotifier } from './integrations/notifications/ResendEmailNotifier';
import { WebPushNotifier } from './integrations/notifications/WebPushNotifier';
import { logger } from './observability/logger';
import { BillingService } from './services/billingService';
import { createDatabaseBackup } from './services/backupService';
import { ChecklistService } from './services/checklistService';
import { AgendaService } from './services/agendaService';
import { classifyOpportunities, classifyOrganizationOpportunities } from './services/scoring/classificationService';
import { OperationalSyncService } from './services/operationalSyncService';
import { SourceSyncService, type SourceSyncRunResult, type SourceSyncSourceResult } from './services/sourceSyncService';
import { MarketRefreshService, type MarketRefreshResult } from './services/marketRefreshService';
import { shouldRunSync, type SyncMode } from './services/syncPolicy';
import { selectRadarsForNotifications, selectRadarsForRun } from './services/savedSearchService';
import { normalizeOpportunitySnapshot } from './services/opportunityChangeService';
import { NotificationService } from './services/notificationService';
import { PushNotificationService } from './services/pushNotificationService';
import { NotificationBudgetRepository } from './repositories/notificationBudgetRepository';
import { ChecklistRepository } from './repositories/checklistRepository';
import { JobRepository, type JobRecord } from './repositories/jobRepository';
import { OpportunityRepository } from './repositories/opportunityRepository';
import { OrganizationFilterRepository } from './repositories/organizationFilterRepository';
import { OrganizationRepository } from './repositories/organizationRepository';
import { OrganizationSyncSettingsRepository } from './repositories/organizationSyncSettingsRepository';
import { SavedSearchRepository } from './repositories/savedSearchRepository';
import { SourceSyncRepository } from './repositories/sourceSyncRepository';
import { SystemStateRepository } from './repositories/systemStateRepository';
import type { WorkerStage } from './repositories/systemStateRepository';

export interface WorkerCycleMetrics {
  startedAt: string;
  finishedAt: string;
  jobsRecovered: number;
  jobsCreated: number;
  jobsCompleted: number;
  jobsFailed: number;
  sourceResults: Array<Pick<SourceSyncSourceResult, 'source' | 'status' | 'received' | 'created' | 'updated' | 'errorCategory'>>;
  marketRefresh?: Pick<MarketRefreshResult, 'received' | 'created' | 'updated' | 'observationsReceived' | 'resultsReceived'>;
  agendaPrepared: number;
  notificationsQueued: number;
  notificationsDelivered: number;
  backupPath: string | null;
  pauseReason: string | null;
}

export interface WorkerCycleResult {
  paused: boolean;
  reason?: string | null;
  synced: number;
  classified: number;
  notified: number;
  metrics: WorkerCycleMetrics;
}

export interface WorkerCycleOptions {
  mode?: SyncMode;
  organizationId?: number;
  radarId?: number;
}

export interface WorkerRuntimeDependencies {
  sourceClients?: readonly PagedOfficialSourceClient[];
  sourceSyncService?: SourceSyncService;
  marketRefreshService?: MarketRefreshService;
  backup?: typeof createDatabaseBackup;
  now?: () => Date;
  healthCheck?: () => Promise<boolean>;
}

interface SourceJobPayload {
  organizationId: number;
  radarId: number | null;
  filters: FilterConfig;
  today: string;
}

interface AgendaJobPayload {
  organizationId: number;
}

interface MarketJobPayload {
  filters: FilterConfig;
  today: string;
  lookbackDays: number;
}

interface SourceScope {
  organizationId: number;
  radarId: number | null;
  filters: FilterConfig;
}

interface SyncAggregate {
  received: number;
  created: number;
  updated: number;
  entries: SourceSyncRunResult['entries'];
}

const DURABLE_JOB_TYPES = new Set(['source_sync', 'agenda_preparation', 'market_refresh']);

export class WorkerRuntime {
  readonly opportunities: OpportunityRepository;
  readonly jobs: JobRepository;
  readonly systemState: SystemStateRepository;
  readonly notifications: NotificationService;
  readonly pushNotifications: PushNotificationService;
  readonly billing: BillingService;
  readonly syncSettings: OrganizationSyncSettingsRepository;
  private readonly db: SqliteDatabase;
  private readonly env: AppEnv;
  private readonly sourceSyncService: SourceSyncService;
  private readonly marketRefreshService: MarketRefreshService;
  private readonly operationalSync: OperationalSyncService;
  private readonly agenda: AgendaService;
  private readonly checklists: ChecklistService;
  private readonly organizationFilters: OrganizationFilterRepository;
  private readonly savedSearches: SavedSearchRepository;
  private readonly now: () => Date;
  private readonly backup: typeof createDatabaseBackup;
  private readonly healthCheckOverride?: () => Promise<boolean>;
  private lastMetrics: WorkerCycleMetrics | null = null;

  constructor(
    env: AppEnv = loadEnv(),
    db?: SqliteDatabase,
    dependencies: WorkerRuntimeDependencies = {},
  ) {
    this.env = env;
    this.db = db ?? createDatabase(env.databaseUrl);
    this.now = dependencies.now ?? (() => new Date());
    this.backup = dependencies.backup ?? createDatabaseBackup;
    this.healthCheckOverride = dependencies.healthCheck;
    this.opportunities = new OpportunityRepository(this.db);
    this.jobs = new JobRepository(this.db);
    this.systemState = new SystemStateRepository(this.db);
    this.notifications = new NotificationService(this.db);
    this.pushNotifications = new PushNotificationService(this.db);
    this.billing = new BillingService(this.db, { trialDays: env.billingTrialDays });
    this.syncSettings = new OrganizationSyncSettingsRepository(this.db);
    this.organizationFilters = new OrganizationFilterRepository(this.db);
    this.savedSearches = new SavedSearchRepository(this.db);
    this.operationalSync = new OperationalSyncService(this.db);
    this.agenda = new AgendaService(this.db);
    this.checklists = new ChecklistService(new ChecklistRepository(this.db));
    const sourceRepository = new SourceSyncRepository(this.db, this.opportunities);
    const clients = dependencies.sourceClients ?? createDefaultSourceRegistry(env);
    this.sourceSyncService = dependencies.sourceSyncService ?? new SourceSyncService({ clients, repository: sourceRepository });
    this.marketRefreshService = dependencies.marketRefreshService ?? new MarketRefreshService({ clients, repository: sourceRepository });
  }

  async runCycle(options: WorkerCycleOptions = {}): Promise<WorkerCycleResult> {
    const cycleStarted = this.now();
    const cycleStartedAt = cycleStarted.toISOString();
    const recovered = this.jobs.recoverInterrupted();
    const currentPause = this.systemState.status();
    const legacyJobs = this.jobs.list('PENDING').filter((job) => job.type === 'sync_and_classify');
    const metrics = newMetrics(cycleStartedAt, recovered.length);
    const mode = options.mode ?? 'automatic';
    const enabledOrganizationIds = this.syncSettings.listEnabledOrganizationIds();
    const canRunAutomatic = shouldRunSync(mode, enabledOrganizationIds.length > 0);

    if (isGlobalPause(currentPause)) {
      metrics.finishedAt = this.now().toISOString();
      metrics.pauseReason = currentPause.reason;
      this.lastMetrics = metrics;
      return { paused: true, reason: currentPause.reason, synced: 0, classified: 0, notified: 0, metrics };
    }

    const pendingDurableJobs = this.jobs.list('PENDING').filter(isDurableJob);
    if (!canRunAutomatic && pendingDurableJobs.length === 0) {
      metrics.finishedAt = this.now().toISOString();
      this.lastMetrics = metrics;
      return { paused: false, synced: 0, classified: 0, notified: 0, metrics };
    }

    const defaultFilters = loadFilters();
    const organizations = new OrganizationRepository(this.db).listAll()
      .filter((organization) => options.organizationId === undefined || organization.id === options.organizationId)
      .filter((organization) => mode === 'manual' || enabledOrganizationIds.includes(organization.id));
    const scopes = this.buildScopes(organizations, mode, options, defaultFilters);
    const sourcePause = sourcePauseState(currentPause);
    const agendaPaused = isStagePaused(currentPause, 'agenda');
    const marketPaused = isStagePaused(currentPause, 'market');
    const notificationsPaused = isStagePaused(currentPause, 'notifications');
    const aggregate: SyncAggregate = { received: 0, created: 0, updated: 0, entries: [] };
    let classified = 0;
    let notified = 0;
    let phase: WorkerStage = 'source';

    let sourceJobs = pendingDurableJobs.filter((job) => job.type === 'source_sync');
    if (sourceJobs.length === 0 && !sourcePause.blockAll) {
      sourceJobs = [];
      for (const scope of scopes) {
        const payload: SourceJobPayload = {
          organizationId: scope.organizationId,
          radarId: scope.radarId,
          filters: scope.filters,
          today: cycleStartedAt,
        };
        const jobId = this.jobs.create(
          'source_sync',
          payload as unknown as Record<string, unknown>,
          `source_sync:${mode}:${scope.organizationId}:${scope.radarId ?? 'default'}:${cycleStartedAt}`,
        );
        metrics.jobsCreated += 1;
        const job = this.jobs.find(jobId);
        if (job) sourceJobs.push(job);
      }
    }

    for (const job of sourceJobs) {
      if (sourcePause.blockAll) break;
      const result = await this.executeSourceJob(job, sourcePause.source, metrics);
      aggregate.received += result.received;
      aggregate.created += result.created;
      aggregate.updated += result.updated;
      aggregate.entries.push(...result.entries);
    }

    try {
      const globalClassification = await classifyOpportunities(this.opportunities, defaultFilters);
      classified += globalClassification.classified;
      for (const organization of organizations) {
        const filters = this.organizationFilters.find(organization.id) ?? this.organizationFilters.save(organization.id, defaultFilters);
        const result = await classifyOrganizationOpportunities(this.opportunities, organization.id, filters, { onlyUnclassified: true });
        classified += result.classified;
      }

      phase = 'agenda';
      let agendaPrepared = 0;
      if (!agendaPaused) {
        let agendaJobs = pendingDurableJobs.filter((job) => job.type === 'agenda_preparation');
        const agendaOrganizationIds = new Set(organizations.map((organization) => organization.id));
        for (const scope of scopes) agendaOrganizationIds.add(scope.organizationId);
        if (agendaJobs.length === 0) {
          agendaJobs = [];
          for (const organizationId of agendaOrganizationIds) {
            const jobId = this.jobs.create(
              'agenda_preparation',
              { organizationId } satisfies AgendaJobPayload as unknown as Record<string, unknown>,
              `agenda_preparation:${organizationId}:${cycleStartedAt}`,
            );
            metrics.jobsCreated += 1;
            const job = this.jobs.find(jobId);
            if (job) agendaJobs.push(job);
          }
        }
        for (const job of agendaJobs) agendaPrepared += this.executeAgendaJob(job, metrics);
      }

      phase = 'market';
      if (!marketPaused) {
        let marketJobs = pendingDurableJobs.filter((job) => job.type === 'market_refresh');
        if (marketJobs.length === 0) {
          marketJobs = [];
          const marketJobId = this.jobs.create(
            'market_refresh',
            {
              filters: defaultFilters,
              today: cycleStartedAt,
              lookbackDays: this.env.marketLookbackDays,
            } satisfies MarketJobPayload as unknown as Record<string, unknown>,
            `market_refresh:${cycleStartedAt}`,
          );
          metrics.jobsCreated += 1;
          const marketJob = this.jobs.find(marketJobId);
          if (marketJob) marketJobs.push(marketJob);
        }
        for (const job of marketJobs) {
          const marketResult = await this.executeMarketJob(job, metrics);
          if (marketResult) metrics.marketRefresh = marketResult;
        }
      }

      phase = 'notifications';
      if (!notificationsPaused) {
        const notificationResult = await this.queueAndDeliverNotifications(
          mode,
          options,
          enabledOrganizationIds,
          cycleStartedAt,
          defaultFilters,
        );
        notified = notificationResult.delivered;
        metrics.notificationsQueued = notificationResult.queued;
        metrics.notificationsDelivered = notificationResult.delivered;
      }

      phase = 'backup';
      if (this.env.databaseUrl !== ':memory:') {
        try {
          metrics.backupPath = this.backup(this.db, this.env.databaseUrl);
        } catch (error) {
          this.pauseStage('backup', 'Backup do banco indisponível', error);
        }
      }

      if (!this.systemState.status().paused) {
        for (const legacyJob of legacyJobs) {
          this.jobs.markCompleted(legacyJob.id);
          metrics.jobsCompleted += 1;
        }
      }

      metrics.agendaPrepared = agendaPrepared;
      metrics.finishedAt = this.now().toISOString();
      metrics.pauseReason = this.systemState.status().reason;
      this.lastMetrics = metrics;
      logger.info({ metrics, sync: aggregate }, 'Worker cycle completed');
      return { paused: false, reason: metrics.pauseReason, synced: aggregate.received, classified, notified, metrics };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Falha desconhecida no worker';
      this.pauseStage(phase, readablePhaseReason(phase), error);
      metrics.finishedAt = this.now().toISOString();
      metrics.pauseReason = this.systemState.status().reason ?? message;
      this.lastMetrics = metrics;
      logger.error({ phase, error: message }, 'Worker stage paused after error');
      throw error;
    }
  }

  async resumeAfterHealthCheck(): Promise<boolean> {
    const healthy = this.healthCheckOverride
      ? await this.healthCheckOverride()
      : await this.sourceSyncService.healthCheck(loadFilters(), this.now());
    if (!healthy) return false;
    this.systemState.resume();
    return true;
  }

  health(): WorkerCycleMetrics | null {
    return this.lastMetrics;
  }

  automaticSyncEnabled(): boolean {
    return this.syncSettings.listEnabledOrganizationIds().length > 0;
  }

  close(): void {
    this.db.close();
  }

  private buildScopes(
    organizations: ReturnType<OrganizationRepository['listAll']>,
    mode: SyncMode,
    options: WorkerCycleOptions,
    defaultFilters: FilterConfig,
  ): SourceScope[] {
    return organizations.flatMap((organization): SourceScope[] => {
      const radars = this.savedSearches.list(organization.id);
      if (radars.length === 0) return [{ organizationId: organization.id, radarId: null, filters: this.organizationFilters.find(organization.id) ?? defaultFilters }];
      return selectRadarsForRun(radars, mode, options.radarId).map((radar) => ({ organizationId: organization.id, radarId: radar.id, filters: radar.filters }));
    });
  }

  private async executeSourceJob(job: JobRecord, pausedSource: SourceId | undefined, metrics: WorkerCycleMetrics): Promise<SyncAggregate> {
    const payload = sourcePayload(job.checkpoint);
    if (!payload) {
      this.jobs.markFailed(job.id, 'Payload de sincronização inválido');
      metrics.jobsFailed += 1;
      return { received: 0, created: 0, updated: 0, entries: [] };
    }
    if (!this.jobs.claim(job.id) && this.jobs.find(job.id)?.status !== 'RUNNING') return { received: 0, created: 0, updated: 0, entries: [] };
    try {
      const result = await this.sourceSyncService.run({
        filters: payload.filters,
        today: new Date(payload.today),
        skipSources: pausedSource ? new Set([pausedSource]) : undefined,
        onEntry: (entry) => this.operationalSync.processEntry(entry),
      });
      this.jobs.updateCheckpoint(job.id, { sourceResults: result.sourceResults.map(sourceMetric) });
      this.jobs.markCompleted(job.id);
      metrics.jobsCompleted += 1;
      for (const source of result.sourceResults) {
        metrics.sourceResults.push(sourceMetric(source));
        if (source.status === 'FAILED') this.pauseSource(source);
      }
      if (payload.radarId !== null) {
        this.savedSearches.markRun(payload.organizationId, payload.radarId, this.now().toISOString(), result.created > 0 ? this.now().toISOString() : null);
      }
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Falha desconhecida na fonte oficial';
      this.jobs.markFailed(job.id, message);
      metrics.jobsFailed += 1;
      this.pauseStage('source', `Sincronização oficial interrompida: ${message}`, error);
      return { received: 0, created: 0, updated: 0, entries: [] };
    }
  }

  private executeAgendaJob(job: JobRecord, metrics: WorkerCycleMetrics): number {
    const payload = agendaPayload(job.checkpoint);
    if (!payload) {
      this.jobs.markFailed(job.id, 'Payload de agenda inválido');
      metrics.jobsFailed += 1;
      return 0;
    }
    if (!this.jobs.claim(job.id) && this.jobs.find(job.id)?.status !== 'RUNNING') return 0;
    try {
      let prepared = 0;
      for (const opportunityId of this.opportunities.listKanbanOpportunityIds(payload.organizationId)) {
        const opportunity = this.opportunities.findById(opportunityId);
        if (!opportunity) continue;
        const current = normalizeOpportunitySnapshot(opportunity);
        this.agenda.scheduleOfficialReminders(payload.organizationId, undefined, current);
        this.checklists.ensureDefaults(payload.organizationId, opportunityId);
        prepared += 1;
      }
      this.jobs.updateCheckpoint(job.id, { prepared });
      this.jobs.markCompleted(job.id);
      metrics.jobsCompleted += 1;
      return prepared;
    } catch (error) {
      this.jobs.markFailed(job.id, error instanceof Error ? error.message : 'Falha desconhecida na agenda');
      metrics.jobsFailed += 1;
      this.pauseStage('agenda', 'Preparação de agenda interrompida', error);
      return 0;
    }
  }

  private async executeMarketJob(job: JobRecord, metrics: WorkerCycleMetrics): Promise<MarketRefreshResult | undefined> {
    const payload = marketPayload(job.checkpoint);
    if (!payload) {
      this.jobs.markFailed(job.id, 'Payload de mercado inválido');
      metrics.jobsFailed += 1;
      return undefined;
    }
    if (!this.jobs.claim(job.id) && this.jobs.find(job.id)?.status !== 'RUNNING') return undefined;
    try {
      const result = await this.marketRefreshService.run({ filters: payload.filters, today: new Date(payload.today), lookbackDays: payload.lookbackDays });
      this.jobs.updateCheckpoint(job.id, { sourceResults: result.sourceResults });
      this.jobs.markCompleted(job.id);
      metrics.jobsCompleted += 1;
      for (const source of result.sourceResults) {
        if (source.status === 'FAILED') this.pauseStage('market', `Atualização de mercado indisponível: ${source.source}`, source.error, source.source);
      }
      return result;
    } catch (error) {
      this.jobs.markFailed(job.id, error instanceof Error ? error.message : 'Falha desconhecida no mercado');
      metrics.jobsFailed += 1;
      this.pauseStage('market', 'Atualização de mercado interrompida', error);
      return undefined;
    }
  }

  private async queueAndDeliverNotifications(
    mode: SyncMode,
    options: WorkerCycleOptions,
    enabledOrganizationIds: number[],
    since: string,
    defaultFilters: FilterConfig,
  ): Promise<{ queued: number; delivered: number }> {
    const notificationWindow = new Date(this.now().getTime() - 60 * 60 * 1_000).toISOString();
    let budget = Math.max(0, this.env.maxNotificationsPerHour - new NotificationBudgetRepository(this.db).countCreatedSince(notificationWindow));
    if (budget <= 0) {
      this.pauseStage('notifications', 'Orçamento de notificações atingido', new Error('MAX_NOTIFICATIONS_PER_HOUR excedido'));
      return { queued: 0, delivered: 0 };
    }
    const organizationIds = mode === 'manual' && options.organizationId !== undefined ? [options.organizationId] : enabledOrganizationIds;
    let queued = 0;
    for (const organizationId of organizationIds) {
      if (budget <= 0 || !this.billing.canUse(organizationId, 'notifications')) continue;
      const radars = this.savedSearches.list(organizationId);
      const selectedRadars = selectRadarsForNotifications(radars, mode, options.radarId);
      if (radars.length === 0) {
        const filters = this.organizationFilters.find(organizationId) ?? defaultFilters;
        const amount = this.notifications.queueRecent(organizationId, since, filters.minimumScore, budget);
        queued += amount;
        budget -= amount;
      } else {
        for (const radar of selectedRadars) {
          if (budget <= 0) break;
          const amount = this.notifications.queueRecentForRadar(organizationId, radar.filters, since, budget);
          queued += amount;
          budget -= amount;
        }
      }
    }
    const deadlineFrom = this.now().toISOString();
    const deadlineTo = new Date(this.now().getTime() + 48 * 60 * 60 * 1_000).toISOString();
    for (const organizationId of organizationIds) {
      if (budget <= 0 || !this.billing.canUse(organizationId, 'notifications')) continue;
      const amount = this.notifications.queueUpcomingDeadlines(organizationId, deadlineFrom, deadlineTo, budget);
      queued += amount;
      budget -= amount;
    }
    for (const organizationId of organizationIds) {
      if (budget <= 0 || !this.billing.canUse(organizationId, 'notifications')) continue;
      const radars = this.savedSearches.list(organizationId);
      const selectedRadars = selectRadarsForNotifications(radars, mode, options.radarId);
      if (radars.length === 0) {
        const amount = this.pushNotifications.queueRecent(since, budget, { organizationId });
        queued += amount;
        budget -= amount;
      } else {
        for (const radar of selectedRadars) {
          if (budget <= 0) break;
          const amount = this.pushNotifications.queueRecentForRadar(organizationId, radar.filters, since, budget);
          queued += amount;
          budget -= amount;
        }
      }
    }
    for (const organizationId of organizationIds) {
      if (budget <= 0 || !this.billing.canUse(organizationId, 'notifications')) continue;
      const amount = this.pushNotifications.queueUpcomingDeadlines(organizationId, deadlineFrom, deadlineTo, budget);
      queued += amount;
      budget -= amount;
    }
    let delivered = 0;
    try {
      if (this.notifications.pendingCount() > 0) delivered += await this.notifications.deliverPending(new ResendEmailNotifier(this.env.resendApiKey, this.env.notificationEmailFrom));
    } catch (error) {
      this.pauseStage('notifications', 'Canal de e-mail indisponível', error);
    }
    try {
      if (this.pushNotifications.pendingCount() > 0) delivered += await this.pushNotifications.deliverPending(new WebPushNotifier(this.env.vapidSubject, this.env.vapidPublicKey, this.env.vapidPrivateKey));
    } catch (error) {
      this.pauseStage('notifications', 'Canal de notificações do dispositivo indisponível', error);
    }
    return { queued, delivered };
  }

  private pauseSource(source: SourceSyncSourceResult): void {
    const reason = source.errorCategory === 'CIRCUIT_OPEN'
      ? `Circuito da fonte ${source.source} aberto`
      : `Fonte oficial ${source.source} indisponível (${source.errorCategory ?? 'UNAVAILABLE'})`;
    this.pauseStage('source', reason, source.error, source.source);
  }

  private pauseStage(stage: WorkerStage, reason: string, error: unknown, source?: SourceId): void {
    this.systemState.pauseStage(stage, reason, { error: error instanceof Error ? error.message : String(error), ...(source ? { source } : {}) });
  }
}

function newMetrics(startedAt: string, jobsRecovered: number): WorkerCycleMetrics {
  return { startedAt, finishedAt: startedAt, jobsRecovered, jobsCreated: 0, jobsCompleted: 0, jobsFailed: 0, sourceResults: [], agendaPrepared: 0, notificationsQueued: 0, notificationsDelivered: 0, backupPath: null, pauseReason: null };
}

function isDurableJob(job: JobRecord): boolean {
  return DURABLE_JOB_TYPES.has(job.type);
}

function isGlobalPause(pause: ReturnType<SystemStateRepository['status']>): boolean {
  return pause.paused && typeof pause.details?.stage !== 'string';
}

function isStagePaused(pause: ReturnType<SystemStateRepository['status']>, stage: WorkerStage): boolean {
  return pause.paused && pause.details?.stage === stage && !pause.details?.source;
}

function sourcePauseState(pause: ReturnType<SystemStateRepository['status']>): { blockAll: boolean; source?: SourceId } {
  if (!pause.paused || pause.details?.stage !== 'source') return { blockAll: false };
  const source = pause.details.source;
  if (source === 'PNCP' || source === 'OPEN_DATA' || source === 'BEC/SP') return { blockAll: false, source };
  return { blockAll: true };
}

function sourcePayload(checkpoint: Record<string, unknown>): SourceJobPayload | undefined {
  if (!isFilterConfig(checkpoint.filters) || typeof checkpoint.organizationId !== 'number' || typeof checkpoint.today !== 'string') return undefined;
  return { organizationId: checkpoint.organizationId, radarId: typeof checkpoint.radarId === 'number' ? checkpoint.radarId : null, filters: checkpoint.filters, today: checkpoint.today };
}

function agendaPayload(checkpoint: Record<string, unknown>): AgendaJobPayload | undefined {
  return typeof checkpoint.organizationId === 'number' ? { organizationId: checkpoint.organizationId } : undefined;
}

function marketPayload(checkpoint: Record<string, unknown>): MarketJobPayload | undefined {
  if (!isFilterConfig(checkpoint.filters) || typeof checkpoint.today !== 'string' || typeof checkpoint.lookbackDays !== 'number') return undefined;
  return { filters: checkpoint.filters, today: checkpoint.today, lookbackDays: checkpoint.lookbackDays };
}

function isFilterConfig(value: unknown): value is FilterConfig {
  if (typeof value !== 'object' || value === null) return false;
  const filters = value as Partial<FilterConfig>;
  return typeof filters.lookbackDays === 'number'
    && Array.isArray(filters.states)
    && Array.isArray(filters.citiesIbge)
    && Array.isArray(filters.modalities)
    && Array.isArray(filters.keywords)
    && Array.isArray(filters.excludedKeywords)
    && typeof filters.minimumScore === 'number'
    && typeof filters.estimatedValueMinCents === 'number'
    && typeof filters.scoreWeights === 'object';
}

function sourceMetric(source: SourceSyncSourceResult): Pick<SourceSyncSourceResult, 'source' | 'status' | 'received' | 'created' | 'updated' | 'errorCategory'> {
  return { source: source.source, status: source.status, received: source.received, created: source.created, updated: source.updated, errorCategory: source.errorCategory };
}

function readablePhaseReason(phase: WorkerStage): string {
  if (phase === 'source') return 'Sincronização oficial interrompida';
  if (phase === 'agenda') return 'Preparação de agenda interrompida';
  if (phase === 'market') return 'Atualização de mercado interrompida';
  if (phase === 'notifications') return 'Entrega de notificações interrompida';
  if (phase === 'backup') return 'Backup do banco interrompido';
  return 'Worker interrompido';
}
