import type { BillingPlanDefinition, BillingPlanCode } from '../config/billingPlans';
import type { SqliteDatabase } from '../db/database';

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
}

export function buildPlatformAdminMetrics(db: SqliteDatabase, plans: BillingPlanDefinition[], now = new Date()): PlatformAdminMetrics {
  const planByCode = new Map(plans.map((plan) => [plan.code, plan]));
  const accountRows = db.prepare('SELECT plan_code, status FROM billing_accounts').all() as Array<{ plan_code: BillingPlanCode; status: string }>;
  const organizationCount = count(db, 'SELECT COUNT(*) AS count FROM organizations');
  const userCount = count(db, 'SELECT COUNT(*) AS count FROM users');
  const opportunityCount = count(db, 'SELECT COUNT(*) AS count FROM opportunities');
  const notificationsThisMonth = countNotificationsThisMonth(db, startOfMonth(now));
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
  };
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
