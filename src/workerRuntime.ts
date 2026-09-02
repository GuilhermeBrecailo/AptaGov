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
import { createDatabaseBackup, validateDatabaseBackupArtifact } from './services/backupService';
import { ChecklistService } from './services/checklistService';
import { AgendaService } from './services/agendaService';
import { classifyOpportunities, classifyOrganizationOpportunities } from './services/scoring/classificationService';
import { OperationalSyncService } from './services/operationalSyncService';
import { SourceSyncService, type SourceSyncRunResult, type SourceSyncSourceResult } from './services/sourceSyncService';
import { MarketRefreshService, type MarketRefreshResult, type MarketRefreshSourceResult } from './services/marketRefreshService';
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
import type { PauseSelector, SystemPauseEntry, WorkerStage } from './repositories/systemStateRepository';
import { OperationalOutboxRepository, type OperationalOutboxEvent } from './repositories/operationalOutboxRepository';
import { WorkerMetricsRepository } from './repositories/workerMetricsRepository';
import type { SyncEntry } from './services/syncService';

export interface WorkerCycleMetrics {
  startedAt: string;
  finishedAt: string;
  jobsRecovered: number;
  jobsCreated: number;
  jobsCompleted: number;
  jobsFailed: number;
  sourceResults: Array<Pick<SourceSyncSourceResult, 'source' | 'status' | 'received' | 'persisted' | 'created' | 'updated' | 'errorCategory'>>;
  marketRefresh?: Pick<MarketRefreshResult, 'received' | 'created' | 'updated' | 'observationsReceived' | 'resultsReceived'> & {
    sourceResults: Array<Pick<MarketRefreshSourceResult, 'source' | 'status' | 'received' | 'persisted' | 'created' | 'updated' | 'observationsReceived' | 'resultsReceived' | 'errorCategory'>>;
  };
  outboxProcessed: number;
  outboxFailed: number;
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
  healthChecks?: Partial<Record<WorkerStage, () => boolean | Promise<boolean>>>;
  notificationHealthChecks?: Partial<Record<'email' | 'push', () => boolean | Promise<boolean>>>;
  workerId?: string;
}

interface SourceJobPayload {
  organizationId: number;
  radarId: number | null;
  filters: FilterConfig;
  today: string;
  scopeKey?: string;
}

interface AgendaJobPayload {
  organizationId: number;
}

interface MarketJobPayload {
  filters: FilterConfig;
  today: string;
  lookbackDays: number;
  organizationId?: number;
  radarId?: number | null;
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
  private readonly healthChecks: Partial<Record<WorkerStage, () => boolean | Promise<boolean>>>;
  private readonly notificationHealthChecks: Partial<Record<'email' | 'push', () => boolean | Promise<boolean>>>;
  private readonly workerId: string;
  private readonly outbox: OperationalOutboxRepository;
  private readonly metricsRepository: WorkerMetricsRepository;
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
    this.healthChecks = dependencies.healthChecks ?? {};
    this.notificationHealthChecks = dependencies.notificationHealthChecks ?? {};
    this.workerId = dependencies.workerId ?? `worker:${process.pid}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
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
    this.outbox = new OperationalOutboxRepository(this.db);
    this.metricsRepository = new WorkerMetricsRepository(this.db);
    const sourceRepository = new SourceSyncRepository(this.db, this.opportunities);
    const clients = dependencies.sourceClients ?? createDefaultSourceRegistry(env);
    this.sourceSyncService = dependencies.sourceSyncService ?? new SourceSyncService({ clients, repository: sourceRepository });
    this.marketRefreshService = dependencies.marketRefreshService ?? new MarketRefreshService({ clients, repository: sourceRepository });
  }

  async runCycle(options: WorkerCycleOptions = {}): Promise<WorkerCycleResult> {
    const cycleStarted = this.now();
    const cycleStartedAt = cycleStarted.toISOString();
    const mode = options.mode ?? 'automatic';
    if (mode === 'manual' && options.organizationId !== undefined && options.radarId !== undefined
      && !this.manualRadarBelongsToOrganization(options.organizationId, options.radarId)) {
      throw new Error('Radar não pertence à organização informada');
    }
    const recovered = this.jobs.recoverInterrupted(this.now(), this.env.workerLeaseMs);
    const currentPause = this.systemState.status();
    const legacyJobs = this.jobs.list('PENDING').filter((job) => job.type === 'sync_and_classify');
    const metrics = newMetrics(cycleStartedAt, recovered.length);
    const enabledOrganizationIds = this.syncSettings.listEnabledOrganizationIds();
    const canRunAutomatic = shouldRunSync(mode, enabledOrganizationIds.length > 0);

    if (!canRunAutomatic) {
      for (const legacyJob of legacyJobs) {
        this.jobs.markLegacyCompleted(legacyJob.id);
      }
      metrics.jobsCompleted += legacyJobs.length;
    }

    if (isGlobalPause(currentPause)) {
      metrics.finishedAt = this.now().toISOString();
      metrics.pauseReason = currentPause.reason;
      this.recordMetrics(metrics, mode);
      return { paused: true, reason: currentPause.reason, synced: 0, classified: 0, notified: 0, metrics };
    }

    const pendingDurableJobs = this.jobs.list(
      'PENDING',
      mode === 'manual' && options.organizationId !== undefined
        ? { organizationId: options.organizationId, ...(options.radarId !== undefined ? { radarId: options.radarId } : {}) }
        : undefined,
    ).filter(isDurableJob);
    if (!canRunAutomatic && pendingDurableJobs.length === 0) {
      metrics.finishedAt = this.now().toISOString();
      const paused = this.systemState.status().paused;
      metrics.pauseReason = this.systemState.status().reason;
      this.recordMetrics(metrics, mode);
      return { paused, reason: metrics.pauseReason, synced: 0, classified: 0, notified: 0, metrics };
    }

    const defaultFilters = loadFilters();
    const organizations = new OrganizationRepository(this.db).listAll()
      .filter((organization) => options.organizationId === undefined || organization.id === options.organizationId)
      .filter((organization) => mode === 'manual' || enabledOrganizationIds.includes(organization.id));
    const scopes = this.buildScopes(organizations, mode, options, defaultFilters);
    const sourcePause = sourcePauseState(this.systemState);
    const agendaPaused = hasUnscopedPause(this.systemState, 'agenda');
    const marketPaused = hasUnscopedPause(this.systemState, 'market');
    const notificationsPaused = hasUnscopedPause(this.systemState, 'notifications');
    const aggregate: SyncAggregate = { received: 0, created: 0, updated: 0, entries: [] };
    let classified = 0;
    let notified = 0;
    let phase: WorkerStage = 'source';

    let sourceJobs = pendingDurableJobs.filter((job) => job.type === 'source_sync');
    if (sourceJobs.length === 0 && canRunAutomatic && !sourcePause.blockAll) {
      sourceJobs = [];
      for (const scope of scopes) {
        const payload: SourceJobPayload = {
          organizationId: scope.organizationId,
          radarId: scope.radarId,
          filters: scope.filters,
          today: cycleStartedAt,
          scopeKey: sourceScopeKey(scope.organizationId, scope.radarId),
        };
        const reservation = this.jobs.reserve(
          'source_sync',
          payload as unknown as Record<string, unknown>,
          `source_sync:${mode}:${scope.organizationId}:${scope.radarId ?? 'default'}:${cycleKey(cycleStarted, mode, scope.organizationId, scope.radarId, this.env.syncIntervalMinutes)}`,
          { organizationId: scope.organizationId, radarId: scope.radarId },
        );
        if (reservation.created) metrics.jobsCreated += 1;
        const job = this.jobs.find(reservation.id);
        if (job) sourceJobs.push(job);
      }
    }

    for (const job of sourceJobs) {
      if (sourcePause.blockAll) break;
      const result = await this.executeSourceJob(job, sourcePause.sources, metrics, mode, options);
      aggregate.received += result.received;
      aggregate.created += result.created;
      aggregate.updated += result.updated;
      aggregate.entries.push(...result.entries);
    }

    const outboxResult = this.processOperationalOutbox(mode === 'manual' ? options.organizationId : undefined);
    metrics.outboxProcessed = outboxResult.processed;
    metrics.outboxFailed = outboxResult.failed;

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
            const reservation = this.jobs.reserve(
              'agenda_preparation',
              { organizationId } satisfies AgendaJobPayload as unknown as Record<string, unknown>,
              `agenda_preparation:${organizationId}:${cycleKey(cycleStarted, mode, organizationId, null, this.env.syncIntervalMinutes)}`,
              { organizationId },
            );
            if (reservation.created) metrics.jobsCreated += 1;
            const job = this.jobs.find(reservation.id);
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
          const marketOrganizationId = mode === 'manual' ? options.organizationId : undefined;
          const reservation = this.jobs.reserve(
            'market_refresh',
            {
              filters: defaultFilters,
              today: cycleStartedAt,
              lookbackDays: this.env.marketLookbackDays,
              ...(marketOrganizationId === undefined ? {} : { organizationId: marketOrganizationId, radarId: options.radarId ?? null }),
            } satisfies MarketJobPayload as unknown as Record<string, unknown>,
            `market_refresh:${mode}:${marketOrganizationId ?? 'global'}:${options.radarId ?? 'all'}:${cycleKey(cycleStarted, mode, marketOrganizationId, options.radarId ?? null, this.env.syncIntervalMinutes)}`,
            { organizationId: marketOrganizationId ?? null, radarId: options.radarId ?? null },
          );
          if (reservation.created) metrics.jobsCreated += 1;
          const marketJob = this.jobs.find(reservation.id);
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
      if (this.env.databaseUrl !== ':memory:' && !hasUnscopedPause(this.systemState, 'backup')) {
        try {
          const backupPath = this.backup(this.db, this.env.databaseUrl);
          if (!validateDatabaseBackupArtifact(backupPath)) throw new Error('Backup artifact integrity check failed');
          metrics.backupPath = backupPath;
        } catch (error) {
          this.pauseStage('backup', 'Backup do banco indisponível', error);
        }
      }

      metrics.agendaPrepared = agendaPrepared;
      metrics.finishedAt = this.now().toISOString();
      metrics.pauseReason = this.systemState.status().reason;
      this.recordMetrics(metrics, mode);
      logger.info({ metrics, sync: aggregate }, 'Worker cycle completed');
      const paused = this.systemState.status().paused;
      return { paused, reason: metrics.pauseReason, synced: aggregate.received, classified, notified, metrics };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Falha desconhecida no worker';
      this.pauseStage(phase, readablePhaseReason(phase), error);
      metrics.finishedAt = this.now().toISOString();
      metrics.pauseReason = this.systemState.status().reason ?? message;
      this.recordMetrics(metrics, mode);
      logger.error({ phase, error: message }, 'Worker stage paused after error');
      throw error;
    }
  }

  async resumeAfterHealthCheck(): Promise<boolean> {
    const current = this.systemState.status();
    if (!current.paused) return true;
    let allHealthy = true;
    let globalHealthy = true;
    let componentUnhealthy = false;
    if (current.global) {
      globalHealthy = await this.healthCheckFor({
        stage: 'worker',
        reason: current.reason ?? 'Pausa global',
        details: current.details ?? {},
        pausedAt: '',
        updatedAt: '',
      });
      if (!globalHealthy) allHealthy = false;
    }
    for (const pause of current.pauses ?? []) {
      if (current.global && pause.stage === 'worker' && !pause.source && !pause.channel) continue;
      const healthy = await this.healthCheckFor(pause);
      if (healthy) this.systemState.resume({ stage: pause.stage, source: pause.source, channel: pause.channel });
      else {
        allHealthy = false;
        componentUnhealthy = true;
      }
    }
    if (current.global && globalHealthy && !componentUnhealthy) this.systemState.resume({ stage: 'worker' });
    return allHealthy && !this.systemState.status().paused;
  }

  health(): WorkerCycleMetrics | null {
    if (this.lastMetrics) return this.lastMetrics;
    return this.metricsRepository.latest<WorkerCycleMetrics>()?.metrics ?? null;
  }

  private recordMetrics(metrics: WorkerCycleMetrics, mode: SyncMode): void {
    this.lastMetrics = metrics;
    this.metricsRepository.save(mode, metrics, this.systemState.status().paused);
  }

  private async healthCheckFor(pause: SystemPauseEntry): Promise<boolean> {
    if (pause.stage === 'notifications') return this.notificationHealthCheck(pause.channel);
    if (pause.stage === 'backup') return this.backupHealthCheck();
    const custom = this.healthChecks[pause.stage];
    if (custom) return Boolean(await custom());
    if (pause.stage === 'worker' && this.healthCheckOverride) return this.healthCheckOverride();
    if (pause.stage === 'source') return this.sourceSyncService.healthCheck(loadFilters(), this.now(), sourceIdFrom(pause.source));
    if (pause.stage === 'market') return this.marketRefreshService.healthCheck(loadFilters(), this.now(), sourceIdFrom(pause.source));
    return this.databaseHealthy();
  }

  private async notificationHealthCheck(channel?: string): Promise<boolean> {
    if (channel === 'email' || channel === 'push') {
      const controlledCheck = this.notificationHealthChecks[channel];
      if (controlledCheck) return Boolean(await controlledCheck());
      if (!this.notificationChannelConfigured(channel)) return false;
      return channel === 'email'
        ? this.notifications.hasRecentSuccess(this.recentNotificationSince())
        : this.pushNotifications.hasRecentSuccess(this.recentNotificationSince());
    }
    const checks: Array<'email' | 'push'> = [];
    if (this.notificationChannelConfigured('email')) checks.push('email');
    if (this.notificationChannelConfigured('push')) checks.push('push');
    if (checks.length === 0) return false;
    const healthy = await Promise.all(checks.map((item) => this.notificationHealthCheck(item)));
    return healthy.every(Boolean);
  }

  private notificationChannelConfigured(channel?: string): boolean {
    if (channel === 'email') return Boolean(this.env.resendApiKey && this.env.notificationEmailFrom);
    if (channel === 'push') return this.pushNotifications.isConfigured(this.env.vapidSubject, this.env.vapidPublicKey, this.env.vapidPrivateKey);
    return true;
  }

  private recentNotificationSince(): string {
    return new Date(this.now().getTime() - 15 * 60_000).toISOString();
  }

  private databaseHealthy(): boolean {
    try {
      const result = this.db.prepare('PRAGMA integrity_check').get() as { integrity_check?: unknown } | undefined;
      return result?.integrity_check === 'ok';
    } catch {
      return false;
    }
  }

  private async backupHealthCheck(): Promise<boolean> {
    const custom = this.healthChecks.backup;
    if (custom && !(await custom())) return false;
    const latestBackupPath = this.lastBackupPath();
    return this.databaseHealthy()
      && latestBackupPath !== null
      && validateDatabaseBackupArtifact(latestBackupPath);
  }

  private lastBackupPath(): string | null {
    const current = this.lastMetrics?.backupPath;
    if (typeof current === 'string' && current) return current;
    const persisted = this.metricsRepository.list<WorkerCycleMetrics>(20);
    const previous = persisted
      .map((entry) => entry.metrics.backupPath)
      .find((path): path is string => typeof path === 'string' && path.length > 0);
    return previous ?? null;
  }

  automaticSyncEnabled(): boolean {
    return this.syncSettings.listEnabledOrganizationIds().length > 0;
  }

  manualRadarBelongsToOrganization(organizationId: number, radarId: number): boolean {
    return Boolean(this.savedSearches.find(organizationId, radarId));
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

  private async executeSourceJob(
    job: JobRecord,
    pausedSources: ReadonlySet<SourceId>,
    metrics: WorkerCycleMetrics,
    mode: SyncMode,
    options: WorkerCycleOptions,
  ): Promise<SyncAggregate> {
    const payload = sourcePayload(job.checkpoint);
    if (!payload) {
      this.jobs.markInvalidPayload(job.id, 'Payload de sincronização inválido');
      metrics.jobsFailed += 1;
      return { received: 0, created: 0, updated: 0, entries: [] };
    }
    if (!jobInScope(job, mode, options, payload)) return { received: 0, created: 0, updated: 0, entries: [] };
    if (payload.radarId !== null && !this.savedSearches.find(payload.organizationId, payload.radarId)) {
      this.jobs.markInvalidPayload(job.id, 'Radar da sincronização não existe');
      metrics.jobsFailed += 1;
      return { received: 0, created: 0, updated: 0, entries: [] };
    }
    const owner = this.workerId;
    if (!this.jobs.claim(job.id, owner, this.env.workerLeaseMs, { organizationId: payload.organizationId, radarId: payload.radarId })) {
      return { received: 0, created: 0, updated: 0, entries: [] };
    }
    try {
      const result = await this.withLeaseHeartbeat(job.id, owner, () => this.sourceSyncService.run({
          filters: payload.filters,
          today: new Date(payload.today),
           organizationId: payload.organizationId,
           radarId: payload.radarId,
           scopeKey: payload.scopeKey ?? sourceScopeKey(payload.organizationId, payload.radarId),
           skipSources: pausedSources.size > 0 ? pausedSources : undefined,
           throwOnAllFailed: false,
         }));
      const sourceResults = result.sourceResults.map(sourceMetric);
      this.jobs.updateCheckpoint(job.id, { sourceResults }, owner);
      const allSourcesFailed = result.sourceResults.length > 0
        && result.sourceResults.every((source) => source.status === 'FAILED');
      if (allSourcesFailed) {
        this.jobs.markFailed(job.id, 'Nenhuma fonte oficial disponível', owner);
        metrics.jobsFailed += 1;
      } else {
        this.jobs.markCompleted(job.id, owner);
        metrics.jobsCompleted += 1;
      }
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
      this.jobs.markFailed(job.id, message, owner);
      metrics.jobsFailed += 1;
      this.pauseStage('source', `Sincronização oficial interrompida: ${message}`, error);
      return { received: 0, created: 0, updated: 0, entries: [] };
    }
  }

  private processOperationalOutbox(organizationId: number | undefined): { processed: number; failed: number } {
    let processed = 0;
    let failed = 0;
    const maxEventsPerCycle = 100;
    while (processed + failed < maxEventsPerCycle) {
      const event = this.outbox.claimNext(this.workerId, this.env.workerLeaseMs, organizationId);
      if (!event) break;
      try {
        const entry = outboxEntry(event);
        if (!entry) throw new Error('Evento operacional inválido');
        this.operationalSync.processEntry(entry, event.organizationId === null ? {} : { organizationId: event.organizationId });
        this.outbox.complete(event.id, this.workerId, event.organizationId);
        processed += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Falha no efeito operacional';
        this.outbox.fail(event.id, message, this.workerId, event.organizationId);
        this.pauseStage('agenda', 'Efeito operacional pendente de reprocessamento', error);
        failed += 1;
      }
    }
    return { processed, failed };
  }

  private executeAgendaJob(job: JobRecord, metrics: WorkerCycleMetrics): number {
    const payload = agendaPayload(job.checkpoint);
    if (!payload) {
      this.jobs.markInvalidPayload(job.id, 'Payload de agenda inválido');
      metrics.jobsFailed += 1;
      return 0;
    }
    const owner = this.workerId;
    if (!this.jobs.claim(job.id, owner, this.env.workerLeaseMs, { organizationId: payload.organizationId })) return 0;
    try {
      let prepared = 0;
      for (const opportunityId of this.opportunities.listKanbanOpportunityIds(payload.organizationId)) {
        if (!this.jobs.renew(job.id, owner, this.env.workerLeaseMs)) throw new Error('Lease da preparaÃ§Ã£o de agenda expirado');
        const opportunity = this.opportunities.findById(opportunityId);
        if (!opportunity) continue;
        const current = normalizeOpportunitySnapshot(opportunity);
        this.agenda.scheduleOfficialReminders(payload.organizationId, undefined, current);
        this.checklists.ensureDefaults(payload.organizationId, opportunityId);
        prepared += 1;
      }
      this.jobs.updateCheckpoint(job.id, { prepared }, owner);
      this.jobs.markCompleted(job.id, owner);
      metrics.jobsCompleted += 1;
      return prepared;
    } catch (error) {
      this.jobs.markFailed(job.id, error instanceof Error ? error.message : 'Falha desconhecida na agenda', owner);
      metrics.jobsFailed += 1;
      this.pauseStage('agenda', 'Preparação de agenda interrompida', error);
      return 0;
    }
  }

  private async executeMarketJob(job: JobRecord, metrics: WorkerCycleMetrics): Promise<MarketRefreshResult | undefined> {
    const payload = marketPayload(job.checkpoint);
    if (!payload) {
      this.jobs.markInvalidPayload(job.id, 'Payload de mercado inválido');
      metrics.jobsFailed += 1;
      return undefined;
    }
    const owner = this.workerId;
    if (!this.jobs.claim(job.id, owner, this.env.workerLeaseMs, { organizationId: payload.organizationId, radarId: payload.radarId })) return undefined;
    try {
      const pausedSources = pausedSourceIds(this.systemState, 'market');
      const result = await this.withLeaseHeartbeat(job.id, owner, () => this.marketRefreshService.run({
          filters: payload.filters,
          today: new Date(payload.today),
          lookbackDays: payload.lookbackDays,
          organizationId: payload.organizationId,
          radarId: payload.radarId,
          scopeKey: marketScopeKey(payload.organizationId, payload.radarId),
          skipSources: pausedSources.size > 0 ? pausedSources : undefined,
        }));
      this.jobs.updateCheckpoint(job.id, { sourceResults: result.sourceResults }, owner);
      this.jobs.markCompleted(job.id, owner);
      metrics.jobsCompleted += 1;
      for (const source of result.sourceResults) {
        if (source.status === 'FAILED') this.pauseStage('market', `Atualização de mercado indisponível: ${source.source}`, source.error, source.source);
      }
      return result;
    } catch (error) {
      this.jobs.markFailed(job.id, error instanceof Error ? error.message : 'Falha desconhecida no mercado', owner);
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
    const deliveryOrganizationId = mode === 'manual' ? options.organizationId : undefined;
    try {
      if (!isPausedFor(this.systemState, 'notifications', { channel: 'email' }) && this.notifications.pendingCount(deliveryOrganizationId) > 0) delivered += await this.notifications.deliverPending(new ResendEmailNotifier(this.env.resendApiKey, this.env.notificationEmailFrom), deliveryOrganizationId);
    } catch (error) {
      this.pauseStage('notifications', 'Canal de e-mail indisponível', error);
    }
    try {
      if (!isPausedFor(this.systemState, 'notifications', { channel: 'push' }) && this.pushNotifications.pendingCount(deliveryOrganizationId) > 0) delivered += await this.pushNotifications.deliverPending(new WebPushNotifier(this.env.vapidSubject, this.env.vapidPublicKey, this.env.vapidPrivateKey), deliveryOrganizationId);
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

  private pauseStage(stage: WorkerStage, reason: string, error: unknown, source?: SourceId, channel?: string): void {
    const inferredChannel = channel ?? (stage === 'notifications'
      ? (/e-mail/i.test(reason) ? 'email' : /dispositivo/i.test(reason) ? 'push' : undefined)
      : undefined);
    this.systemState.pauseStage(stage, reason, { error: error instanceof Error ? error.message : String(error), ...(source ? { source } : {}), ...(inferredChannel ? { channel: inferredChannel } : {}) });
  }

  private async withLeaseHeartbeat<T>(jobId: number, owner: string, operation: () => Promise<T>): Promise<T> {
    const intervalMs = Math.max(10, Math.min(60_000, Math.floor(this.env.workerLeaseMs / 3)));
    let leaseLost = false;
    const timer = setInterval(() => {
      if (!this.jobs.renew(jobId, owner, this.env.workerLeaseMs)) leaseLost = true;
    }, intervalMs);
    try {
      const result = await operation();
      if (leaseLost) throw new Error('Lease do job expirado durante a operaÃ§Ã£o');
      return result;
    } finally {
      clearInterval(timer);
    }
  }
}

function newMetrics(startedAt: string, jobsRecovered: number): WorkerCycleMetrics {
  return { startedAt, finishedAt: startedAt, jobsRecovered, jobsCreated: 0, jobsCompleted: 0, jobsFailed: 0, sourceResults: [], agendaPrepared: 0, notificationsQueued: 0, notificationsDelivered: 0, outboxProcessed: 0, outboxFailed: 0, backupPath: null, pauseReason: null };
}

function isDurableJob(job: JobRecord): boolean {
  return DURABLE_JOB_TYPES.has(job.type);
}

function isGlobalPause(pause: ReturnType<SystemStateRepository['status']>): boolean {
  return pause.paused && pause.global === true;
}

function hasUnscopedPause(repository: SystemStateRepository, stage: WorkerStage): boolean {
  const status = repository.status();
  if (isGlobalPause(status)) return true;
  return repository.listPauses().some((pause) => pause.stage === stage && !pause.source && !pause.channel);
}

function isPausedFor(repository: SystemStateRepository, stage: WorkerStage, selector: Omit<PauseSelector, 'stage'>): boolean {
  return hasUnscopedPause(repository, stage) || repository.isStagePaused(stage, selector);
}

function sourcePauseState(repository: SystemStateRepository): { blockAll: boolean; sources: ReadonlySet<SourceId> } {
  const status = repository.status();
  if (isGlobalPause(status)) return { blockAll: true, sources: new Set() };
  const pauses = repository.listPauses().filter((pause) => pause.stage === 'source');
  if (pauses.some((pause) => !pause.source)) return { blockAll: true, sources: new Set() };
  return { blockAll: false, sources: new Set(pauses.map((pause) => pause.source).filter(isSourceId)) };
}

function sourcePayload(checkpoint: Record<string, unknown>): SourceJobPayload | undefined {
  if (!isFilterConfig(checkpoint.filters) || typeof checkpoint.organizationId !== 'number' || typeof checkpoint.today !== 'string') return undefined;
  return { organizationId: checkpoint.organizationId, radarId: typeof checkpoint.radarId === 'number' ? checkpoint.radarId : null, filters: checkpoint.filters, today: checkpoint.today, scopeKey: typeof checkpoint.scopeKey === 'string' ? checkpoint.scopeKey : undefined };
}

function agendaPayload(checkpoint: Record<string, unknown>): AgendaJobPayload | undefined {
  return typeof checkpoint.organizationId === 'number' ? { organizationId: checkpoint.organizationId } : undefined;
}

function marketPayload(checkpoint: Record<string, unknown>): MarketJobPayload | undefined {
  if (!isFilterConfig(checkpoint.filters) || typeof checkpoint.today !== 'string' || typeof checkpoint.lookbackDays !== 'number') return undefined;
  return { filters: checkpoint.filters, today: checkpoint.today, lookbackDays: checkpoint.lookbackDays, organizationId: typeof checkpoint.organizationId === 'number' ? checkpoint.organizationId : undefined, radarId: typeof checkpoint.radarId === 'number' ? checkpoint.radarId : null };
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

function sourceMetric(source: SourceSyncSourceResult): Pick<SourceSyncSourceResult, 'source' | 'status' | 'received' | 'persisted' | 'created' | 'updated' | 'errorCategory'> {
  return { source: source.source, status: source.status, received: source.received, persisted: source.persisted, created: source.created, updated: source.updated, errorCategory: source.errorCategory };
}

function cycleKey(now: Date, _mode: SyncMode, _organizationId: number | undefined, _radarId: number | null, intervalMinutes: number): string {
  return `cycle:${Math.floor(now.getTime() / (Math.max(1, intervalMinutes) * 60_000))}`;
}

function sourceScopeKey(organizationId: number, radarId: number | null): string {
  return `organization:${organizationId}:radar:${radarId ?? 'default'}`;
}

function marketScopeKey(organizationId: number | undefined, radarId: number | null | undefined): string {
  return `market:${organizationId ?? 'global'}:${radarId ?? 'all'}`;
}

function pausedSourceIds(repository: SystemStateRepository, stage: WorkerStage): ReadonlySet<SourceId> {
  return new Set(repository.listPauses().filter((pause) => pause.stage === stage && isSourceId(pause.source)).map((pause) => pause.source as SourceId));
}

function sourceIdFrom(value: string | undefined): SourceId | undefined {
  return isSourceId(value) ? value : undefined;
}

function isSourceId(value: string | undefined): value is SourceId {
  return value === 'PNCP' || value === 'OPEN_DATA' || value === 'BEC/SP';
}

function jobInScope(job: JobRecord, mode: SyncMode, options: WorkerCycleOptions, payload: SourceJobPayload): boolean {
  if (mode !== 'manual') return true;
  return options.organizationId !== undefined
    && payload.organizationId === options.organizationId
    && job.tenantOrganizationId === options.organizationId
    && (options.radarId === undefined || payload.radarId === options.radarId);
}

function outboxEntry(event: OperationalOutboxEvent): SyncEntry | undefined {
  if (event.eventType !== 'OPPORTUNITY_SYNCED' || !isRecord(event.payload)) return undefined;
  const current = event.payload.current;
  if (!isRecord(current)) return undefined;
  const previous = event.payload.previous;
  return {
    previous: isRecord(previous) ? normalizeOpportunitySnapshot(previous as never) : undefined,
    current: normalizeOpportunitySnapshot(current as never),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readablePhaseReason(phase: WorkerStage): string {
  if (phase === 'source') return 'Sincronização oficial interrompida';
  if (phase === 'agenda') return 'Preparação de agenda interrompida';
  if (phase === 'market') return 'Atualização de mercado interrompida';
  if (phase === 'notifications') return 'Entrega de notificações interrompida';
  if (phase === 'backup') return 'Backup do banco interrompido';
  return 'Worker interrompido';
}
