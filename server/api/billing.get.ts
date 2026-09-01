import { defineEventHandler } from 'h3';
import { findBillingPlan } from '../../src/config/billingPlans';
import { loadEnv } from '../../src/config/env';
import { getRuntime, requireAuth } from '../utils/app';

export default defineEventHandler((event) => {
  const context = requireAuth(event);
  const env = loadEnv();
  const runtime = getRuntime();
  const account = runtime.billing.account(context.organization.id);
  const currentPlan = findBillingPlan(env.billingPlans, account?.planCode ?? 'STARTER');
  return {
    plan: account?.plan ?? 'TRIAL',
    planCode: account?.planCode ?? 'STARTER',
    status: account?.status ?? 'INACTIVE',
    trialEndsAt: account?.trialEndsAt ?? null,
    currentPeriodEndsAt: account?.currentPeriodEndsAt ?? null,
    canUse: runtime.billing.canUse(context.organization.id, 'catalog'),
    provider: env.billingProvider,
    monthlyPriceCents: currentPlan.priceCents,
    plans: env.billingPlans,
  };
});
