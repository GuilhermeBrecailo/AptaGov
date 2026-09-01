import type { SqliteDatabase } from '../db/database';
import type { BillingPlanCode } from '../config/billingPlans';

export type BillingPlan = 'TRIAL' | 'PRO';
export type BillingStatus = 'TRIALING' | 'ACTIVE' | 'PAST_DUE' | 'CANCELED' | 'INACTIVE';

export interface BillingAccount {
  organizationId: number;
  plan: BillingPlan;
  planCode: BillingPlanCode;
  status: BillingStatus;
  trialEndsAt: string;
  currentPeriodEndsAt: string | null;
  provider: string | null;
  providerCustomerId: string | null;
  providerSubscriptionId: string | null;
}

export interface BillingEventInput {
  provider: string;
  eventId: string;
  eventType: string;
  organizationId: number | null;
  payload: unknown;
}

export class BillingRepository {
  constructor(private readonly db: SqliteDatabase) {}

  findAccount(organizationId: number): BillingAccount | undefined {
    const row = this.db.prepare('SELECT * FROM billing_accounts WHERE organization_id = ?').get(organizationId) as BillingAccountRow | undefined;
    return row ? mapAccount(row) : undefined;
  }

  createTrial(organizationId: number, trialEndsAt: string): BillingAccount {
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO billing_accounts (organization_id, plan, status, trial_ends_at, created_at, updated_at)
      VALUES (?, 'TRIAL', 'TRIALING', ?, ?, ?)
      ON CONFLICT(organization_id) DO NOTHING
    `).run(organizationId, trialEndsAt, now, now);
    return this.findAccount(organizationId) as BillingAccount;
  }

  activate(organizationId: number, input: {
    provider: string;
    providerCustomerId: string | null;
    providerSubscriptionId: string | null;
    currentPeriodEndsAt: string | null;
    planCode: BillingPlanCode;
  }): BillingAccount {
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE billing_accounts
      SET plan = 'PRO', plan_code = ?, status = 'ACTIVE', provider = ?, provider_customer_id = ?,
        provider_subscription_id = ?, current_period_ends_at = ?, updated_at = ?
      WHERE organization_id = ?
    `).run(input.planCode, input.provider, input.providerCustomerId, input.providerSubscriptionId, input.currentPeriodEndsAt, now, organizationId);
    return this.findAccount(organizationId) as BillingAccount;
  }

  linkCheckout(organizationId: number, provider: string, providerSubscriptionId: string, planCode: BillingPlanCode): BillingAccount {
    this.db.prepare('UPDATE billing_accounts SET provider = ?, provider_subscription_id = ?, plan_code = ?, updated_at = ? WHERE organization_id = ?')
      .run(provider, providerSubscriptionId, planCode, new Date().toISOString(), organizationId);
    return this.findAccount(organizationId) as BillingAccount;
  }

  updateStatus(organizationId: number, status: BillingStatus, currentPeriodEndsAt: string | null): BillingAccount | undefined {
    this.db.prepare('UPDATE billing_accounts SET status = ?, current_period_ends_at = ?, updated_at = ? WHERE organization_id = ?')
      .run(status, currentPeriodEndsAt, new Date().toISOString(), organizationId);
    return this.findAccount(organizationId);
  }

  recordEvent(input: BillingEventInput): boolean {
    const result = this.db.prepare(`
      INSERT INTO billing_events (provider, provider_event_id, event_type, organization_id, payload_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(provider, provider_event_id) DO NOTHING
    `).run(input.provider, input.eventId, input.eventType, input.organizationId, JSON.stringify(input.payload), new Date().toISOString());
    return result.changes > 0;
  }
}

type BillingAccountRow = {
  organization_id: number;
  plan: BillingPlan;
  plan_code: BillingPlanCode;
  status: BillingStatus;
  trial_ends_at: string;
  current_period_ends_at: string | null;
  provider: string | null;
  provider_customer_id: string | null;
  provider_subscription_id: string | null;
};

function mapAccount(row: BillingAccountRow): BillingAccount {
  return {
    organizationId: row.organization_id,
    plan: row.plan,
    planCode: row.plan_code,
    status: row.status,
    trialEndsAt: row.trial_ends_at,
    currentPeriodEndsAt: row.current_period_ends_at,
    provider: row.provider,
    providerCustomerId: row.provider_customer_id,
    providerSubscriptionId: row.provider_subscription_id,
  };
}
