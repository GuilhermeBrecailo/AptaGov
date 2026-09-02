import type { BillingPlanDefinition, BillingPlanCode } from '../config/billingPlans';
import type { AppEnv } from '../config/env';
import type { SqliteDatabase } from '../db/database';
import type { SourceId } from '../domain/sourceTypes';
import { SystemStateRepository } from '../repositories/systemStateRepository';
import { getLatestDatabaseBackupStatus } from './backupService';

const SOURCE_IDS: SourceId[] = ['PNCP', 'OPEN_DATA', 'BEC/SP'];

export type SourceHealthStatus = 'HEALTHY' | 'DEGRADED' | 'UNAVAILABLE' | 'DISABLED' | 'UNKNOWN';

export interface SourceHealthMetrics {
  generatedAt: string;
  lastSuccessfulRunAt: string | null;
  sources: Array<{
    source: SourceId;
    status: SourceHealthStatus;
    lastSuccessfulRunAt: string | null;
    lastErrorCategory: string | null;
    checkpoint: string | null;
    checkpointStatus: string | null;
    checkpointUpdatedAt: string | null;
  }>;
  queueDepth: number;
  notificationFailures: number;
  backupAgeMs: number | null;
  lastBackupAt: string | null;
  pauseReason: string | null;
  paused: boolean;
}

export interface PlatformAdminMetrics {
  generatedAt: string;
  summary: {
    organizations: number;
    users: number;
    activeSubscriptions: number;
    trialingOrganizations: number;
    pastDueOrganizations: number;
    estimatedMrrCents: number;
    opportunities: number;
    notificationsThisMonth: number;
    completedOnboardingOrganizations: number;
    activeRadars: number;
    favoritedOpportunities: number;
    kanbanOpportunities: number;
  };
  plans: Array<BillingPlanDefinition & {
    organizationCount: number;
    activeCount: number;
    estimatedMrrCents: number;
  }>;
  recentOrganizations: Array<{
    id: number;
    name: string;
    ownerEmail: string;
    planCode: BillingPlanCode;
    status: string;
    createdAt: string;
    lastActivityAt: string;
  }>;
  worker: PlatformWorkerMetrics;
}

export interface PlatformWorkerMetrics {
  sourceRuns: Array<{
    id: number;
    source: string;
    flow: string;
    scopeKey: string;
    windowStart: string;
    windowEnd: string;
    status: string;
    received: number;
    persisted: number;
    created: number;
    updated: number;
    errorCategory: string | null;
    startedAt: string;
    finishedAt: string | null;
  }>;
  cycles: Array<{
    id: number;
    mode: 'automatic' | 'manual';
    startedAt: string;
    finishedAt: string;
    paused: boolean;
    jobsRecovered: number;
    jobsCreated: number;
    jobsCompleted: number;
    jobsFailed: number;
    outboxProcessed: number;
    outboxFailed: number;
    agendaPrepared: number;
    notificationsQueued: number;
    notificationsDelivered: number;
    sourceResults: Array<{
      source: string;
      status: string;
      received: number;
      persisted: number;
      created: number;
      updated: number;
      errorCategory: string | null;
    }>;
    marketSourceResults: Array<{
      source: string;
      status: string;
      received: number;
      persisted: number;
      created: number;
      updated: number;
      errorCategory: string | null;
    }>;
  }>;
}

export function buildPlatformAdminMetrics(db: SqliteDatabase, plans: BillingPlanDefinition[], now = new Date()): PlatformAdminMetrics {
  const planByCode = new Map(plans.map((plan) => [plan.code, plan]));
  const accountRows = db.prepare('SELECT plan_code, status FROM billing_accounts').all() as Array<{ plan_code: BillingPlanCode; status: string }>;
  const organizationCount = count(db, 'SELECT COUNT(*) AS count FROM organizations');
  const userCount = count(db, 'SELECT COUNT(*) AS count FROM users');
  const opportunityCount = count(db, 'SELECT COUNT(*) AS count FROM opportunities');
  const notificationsThisMonth = countNotificationsThisMonth(db, startOfMonth(now));
  const completedOnboardingOrganizations = count(db, 'SELECT COUNT(*) AS count FROM organizations WHERE onboarding_completed_at IS NOT NULL');
  const activeRadars = count(db, 'SELECT COUNT(*) AS count FROM saved_searches WHERE enabled = 1');
  const favoritedOpportunities = count(db, "SELECT COUNT(*) AS count FROM opportunity_feedback WHERE status = 'FAVORITED'");
  const kanbanOpportunities = count(db, 'SELECT COUNT(*) AS count FROM organization_opportunities');
  const planStats = plans.map((plan) => {
    const matching = accountRows.filter((account) => account.plan_code === plan.code);
    const activeCount = matching.filter((account) => account.status === 'ACTIVE').length;
    return {
      ...plan,
      organizationCount: matching.length,
      activeCount,
      estimatedMrrCents: activeCount * plan.priceCents,
    };
  });
  const recentOrganizations = db.prepare(`
    SELECT o.id, o.name, u.email AS owner_email, COALESCE(b.plan_code, 'STARTER') AS plan_code,
      COALESCE(b.status, 'INACTIVE') AS status, o.created_at,
      COALESCE(b.updated_at, o.updated_at) AS last_activity_at
    FROM organizations o
    INNER JOIN organization_memberships m ON m.organization_id = o.id AND m.role = 'OWNER'
    INNER JOIN users u ON u.id = m.user_id
    LEFT JOIN billing_accounts b ON b.organization_id = o.id
    ORDER BY o.created_at DESC, o.id DESC
    LIMIT 25
  `).all() as Array<{
    id: number;
    name: string;
    owner_email: string;
    plan_code: BillingPlanCode;
    status: string;
    created_at: string;
    last_activity_at: string;
  }>;
  const estimatedMrrCents = planStats.reduce((total, plan) => total + plan.estimatedMrrCents, 0);

  return {
    generatedAt: now.toISOString(),
    summary: {
      organizations: organizationCount,
      users: userCount,
      activeSubscriptions: accountRows.filter((account) => account.status === 'ACTIVE').length,
      trialingOrganizations: accountRows.filter((account) => account.status === 'TRIALING').length,
      pastDueOrganizations: accountRows.filter((account) => account.status === 'PAST_DUE').length,
      estimatedMrrCents,
      opportunities: opportunityCount,
      notificationsThisMonth,
      completedOnboardingOrganizations,
      activeRadars,
      favoritedOpportunities,
      kanbanOpportunities,
    },
    plans: planStats,
    recentOrganizations: recentOrganizations.map((organization) => ({
      id: organization.id,
      name: organization.name,
      ownerEmail: organization.owner_email,
      planCode: planByCode.has(organization.plan_code) ? organization.plan_code : 'STARTER',
      status: organization.status,
      createdAt: organization.created_at,
      lastActivityAt: organization.last_activity_at,
    })),
    worker: buildWorkerMetrics(db),
  };
}

export function buildSourceHealthMetrics(db: SqliteDatabase, env: AppEnv, now = new Date()): SourceHealthMetrics {
  const sources = SOURCE_IDS.map((source) => buildSourceHealth(db, source, env));
  const backup = getLatestDatabaseBackupStatus('./backups', now);
  const pause = new SystemStateRepository(db).status();
  const successfulRuns = sources
    .map((source) => source.lastSuccessfulRunAt)
    .filter((value): value is string => value !== null)
    .sort()
    .reverse();

  return {
    generatedAt: now.toISOString(),
    lastSuccessfulRunAt: successfulRuns[0] ?? null,
    sources,
    queueDepth: count(db, "SELECT COUNT(*) AS count FROM job_runs WHERE status IN ('PENDING', 'RUNNING', 'FAILED')")
      + count(db, "SELECT COUNT(*) AS count FROM worker_outbox WHERE status IN ('PENDING', 'PROCESSING', 'FAILED')")
      + count(db, "SELECT COUNT(*) AS count FROM notification_deliveries WHERE status IN ('PENDING', 'PROCESSING', 'FAILED')")
      + count(db, "SELECT COUNT(*) AS count FROM push_deliveries WHERE status IN ('PENDING', 'PROCESSING', 'FAILED')"),
    notificationFailures: count(db, "SELECT COUNT(*) AS count FROM notification_deliveries WHERE status = 'FAILED'")
      + count(db, "SELECT COUNT(*) AS count FROM push_deliveries WHERE status = 'FAILED'"),
    backupAgeMs: backup.ageMs,
    lastBackupAt: backup.lastBackupAt,
    pauseReason: pause.reason,
    paused: pause.paused,
  };
}

function buildSourceHealth(db: SqliteDatabase, source: SourceId, env: AppEnv): SourceHealthMetrics['sources'][number] {
  if (source === 'BEC/SP' && !env.becSpEnabled) {
    return {
      source,
      status: 'DISABLED',
      lastSuccessfulRunAt: null,
      lastErrorCategory: null,
      checkpoint: null,
      checkpointStatus: null,
      checkpointUpdatedAt: null,
    };
  }

  const checkpoint = db.prepare(`
    SELECT cursor, status, error_category, updated_at, last_success_at
    FROM source_checkpoints
    WHERE source_code = ?
    ORDER BY updated_at DESC
    LIMIT 1
  `).get(source) as { cursor: string | null; status: string; error_category: string | null; updated_at: string; last_success_at: string | null } | undefined;
  const latestRun = db.prepare(`
    SELECT status, error_category
    FROM source_runs
    WHERE source_code = ?
    ORDER BY COALESCE(finished_at, started_at) DESC, id DESC
    LIMIT 1
  `).get(source) as { status: string; error_category: string | null } | undefined;
  const successful = db.prepare(`
    SELECT MAX(last_success_at) AS last_success_at
    FROM source_checkpoints
    WHERE source_code = ? AND last_success_at IS NOT NULL
  `).get(source) as { last_success_at: string | null };
  const lastError = db.prepare(`
    SELECT error_category
    FROM source_runs
    WHERE source_code = ? AND status = 'FAILED' AND error_category IS NOT NULL
    ORDER BY COALESCE(finished_at, started_at) DESC, id DESC
    LIMIT 1
  `).get(source) as { error_category: string } | undefined;
  const lastSuccessfulRunAt = successful.last_success_at ?? checkpoint?.last_success_at ?? null;

  let status: SourceHealthStatus = 'UNKNOWN';
  if (latestRun?.status === 'FAILED' || checkpoint?.status === 'FAILED') {
    status = lastSuccessfulRunAt ? 'DEGRADED' : 'UNAVAILABLE';
  } else if (latestRun?.status === 'COMPLETED' || checkpoint?.status === 'COMPLETED') {
    status = 'HEALTHY';
  }

  return {
    source,
    status,
    lastSuccessfulRunAt,
    lastErrorCategory: lastError?.error_category ?? checkpoint?.error_category ?? null,
    checkpoint: checkpoint?.cursor ?? null,
    checkpointStatus: checkpoint?.status ?? null,
    checkpointUpdatedAt: checkpoint?.updated_at ?? null,
  };
}

function buildWorkerMetrics(db: SqliteDatabase): PlatformWorkerMetrics {
  const sourceRuns = db.prepare(`
    SELECT id, source_code, flow, scope_key, window_start, window_end, status,
      received_count, persisted_count, created_count, updated_count, error_category,
      started_at, finished_at
    FROM source_runs
    ORDER BY started_at DESC, id DESC
    LIMIT 100
  `).all() as SourceRunAdminRow[];
  const cycles = db.prepare(`
    SELECT id, mode, started_at, finished_at, paused, metrics_json
    FROM worker_cycle_metrics
    ORDER BY finished_at DESC, id DESC
    LIMIT 20
  `).all() as WorkerCycleAdminRow[];
  return {
    sourceRuns: sourceRuns.map((run) => ({
      id: run.id,
      source: run.source_code,
      flow: run.flow,
      scopeKey: run.scope_key,
      windowStart: run.window_start,
      windowEnd: run.window_end,
      status: run.status,
      received: run.received_count,
      persisted: run.persisted_count,
      created: run.created_count,
      updated: run.updated_count,
      errorCategory: run.error_category,
      startedAt: run.started_at,
      finishedAt: run.finished_at,
    })),
    cycles: cycles.map((cycle) => {
      const metrics = parseRecord(cycle.metrics_json);
      return {
        id: cycle.id,
        mode: cycle.mode,
        startedAt: cycle.started_at,
        finishedAt: cycle.finished_at,
        paused: cycle.paused === 1,
        jobsRecovered: numberValue(metrics.jobsRecovered),
        jobsCreated: numberValue(metrics.jobsCreated),
        jobsCompleted: numberValue(metrics.jobsCompleted),
        jobsFailed: numberValue(metrics.jobsFailed),
        outboxProcessed: numberValue(metrics.outboxProcessed),
        outboxFailed: numberValue(metrics.outboxFailed),
        agendaPrepared: numberValue(metrics.agendaPrepared),
        notificationsQueued: numberValue(metrics.notificationsQueued),
        notificationsDelivered: numberValue(metrics.notificationsDelivered),
        sourceResults: safeSourceResults(metrics.sourceResults),
        marketSourceResults: isRecord(metrics.marketRefresh)
          ? safeSourceResults(metrics.marketRefresh.sourceResults)
          : [],
      };
    }),
  };
}

interface SourceRunAdminRow {
  id: number;
  source_code: string;
  flow: string;
  scope_key: string;
  window_start: string;
  window_end: string;
  status: string;
  received_count: number;
  persisted_count: number;
  created_count: number;
  updated_count: number;
  error_category: string | null;
  started_at: string;
  finished_at: string | null;
}

interface WorkerCycleAdminRow {
  id: number;
  mode: 'automatic' | 'manual';
  started_at: string;
  finished_at: string;
  paused: number;
  metrics_json: string;
}

function safeSourceResults(value: unknown): PlatformWorkerMetrics['cycles'][number]['sourceResults'] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map((source) => ({
    source: stringValue(source.source),
    status: stringValue(source.status),
    received: numberValue(source.received),
    persisted: numberValue(source.persisted),
    created: numberValue(source.created),
    updated: numberValue(source.updated),
    errorCategory: source.errorCategory === null ? null : stringValue(source.errorCategory),
  }));
}

function parseRecord(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function count(db: SqliteDatabase, query: string): number {
  return Number((db.prepare(query).get() as { count: number }).count);
}

function countNotificationsThisMonth(db: SqliteDatabase, since: string): number {
  return countWithSince(db, `
    SELECT COUNT(*) AS count
    FROM (
      SELECT id FROM notification_deliveries WHERE created_at >= ?
      UNION ALL
      SELECT id FROM push_deliveries WHERE created_at >= ?
    )
  `, since);
}

function countWithSince(db: SqliteDatabase, query: string, since: string): number {
  return Number((db.prepare(query).get(since, since) as { count: number }).count);
}

function startOfMonth(now: Date): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}
