import type { SqliteDatabase } from '../db/database';
import { BillingRepository, type BillingAccount, type BillingEventInput } from '../repositories/billingRepository';
import type { BillingPlanCode } from '../config/billingPlans';

export type BillingFeature = 'catalog' | 'kanban' | 'notifications';

export class BillingService {
  private readonly billing: BillingRepository;

  constructor(private readonly db: SqliteDatabase, private readonly options: { trialDays: number } = { trialDays: 14 }) {
    this.billing = new BillingRepository(db);
  }

  ensureTrial(organizationId: number): BillingAccount {
    const existing = this.billing.findAccount(organizationId);
    if (existing) return existing;
    const trialEndsAt = new Date(Date.now() + this.options.trialDays * 24 * 60 * 60 * 1000).toISOString();
    return this.billing.createTrial(organizationId, trialEndsAt);
  }

  account(organizationId: number): BillingAccount | undefined {
    return this.billing.findAccount(organizationId) ?? this.ensureTrial(organizationId);
  }

  canUse(organizationId: number, _feature: BillingFeature): boolean {
    const account = this.account(organizationId);
    if (!account) return false;
    if (account.status === 'ACTIVE') return !account.currentPeriodEndsAt || account.currentPeriodEndsAt > new Date().toISOString();
    return account.status === 'TRIALING' && account.trialEndsAt > new Date().toISOString();
  }

  linkCheckout(organizationId: number, provider: string, providerSubscriptionId: string, planCode: BillingPlanCode): BillingAccount {
    this.ensureTrial(organizationId);
    return this.billing.linkCheckout(organizationId, provider, providerSubscriptionId, planCode);
  }

  activateFromWebhook(input: BillingEventInput & {
    organizationId: number;
    providerCustomerId: string | null;
    providerSubscriptionId: string | null;
    currentPeriodEndsAt?: string | null;
    planCode?: BillingPlanCode;
  }): boolean {
    const accepted = this.billing.recordEvent(input);
    if (!accepted) return false;
    this.ensureTrial(input.organizationId);
    this.billing.activate(input.organizationId, {
      provider: input.provider,
      providerCustomerId: input.providerCustomerId,
      providerSubscriptionId: input.providerSubscriptionId,
      currentPeriodEndsAt: input.currentPeriodEndsAt ?? null,
      planCode: input.planCode ?? 'STARTER',
    });
    return true;
  }

  syncFromWebhook(input: BillingEventInput & {
    organizationId: number;
    providerCustomerId: string | null;
    providerSubscriptionId: string | null;
    subscriptionStatus: 'ACTIVE' | 'PAST_DUE' | 'CANCELED' | 'INACTIVE';
    currentPeriodEndsAt?: string | null;
    planCode?: BillingPlanCode;
  }): boolean {
    const accepted = this.billing.recordEvent(input);
    if (!accepted) return false;
    this.ensureTrial(input.organizationId);
    if (input.subscriptionStatus === 'ACTIVE') {
      this.billing.activate(input.organizationId, {
        provider: input.provider,
        providerCustomerId: input.providerCustomerId,
        providerSubscriptionId: input.providerSubscriptionId,
        currentPeriodEndsAt: input.currentPeriodEndsAt ?? null,
        planCode: input.planCode ?? 'STARTER',
      });
    } else {
      this.billing.updateStatus(input.organizationId, input.subscriptionStatus, input.currentPeriodEndsAt ?? null);
    }
    return true;
  }
}
