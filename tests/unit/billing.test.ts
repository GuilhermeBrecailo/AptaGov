import { describe, expect, it } from 'vitest';
import { createTestDatabase } from '../../src/db/database';
import { OrganizationRepository } from '../../src/repositories/organizationRepository';
import { BillingService } from '../../src/services/billingService';
import { loadEnv } from '../../src/config/env';

describe('cobrança por organização', () => {
  it('usa R$50 como preço padrão do plano inicial', () => {
    const env = loadEnv({ NODE_ENV: 'test', DATABASE_URL: ':memory:' });

    expect(env.billingMonthlyPriceCents).toBe(5_000);
    const plans = (env as unknown as { billingPlans: Array<{ code: string; priceCents: number }> }).billingPlans;
    expect(plans.map((plan) => [plan.code, plan.priceCents])).toEqual([
      ['STARTER', 5_000],
      ['PRO', 9_900],
      ['BUSINESS', 19_900],
      ['UNLIMITED', 39_900],
    ]);
  });

  it('cria um trial idempotente e libera o acesso dentro do prazo', () => {
    const db = createTestDatabase();
    const organization = new OrganizationRepository(db).create('Empresa Trial');
    const billing = new BillingService(db, { trialDays: 14 });

    const first = billing.ensureTrial(organization.id);
    const second = billing.ensureTrial(organization.id);

    expect(first.organizationId).toBe(organization.id);
    expect(first.status).toBe('TRIALING');
    expect(second.trialEndsAt).toBe(first.trialEndsAt);
    expect(billing.canUse(organization.id, 'catalog')).toBe(true);
  });

  it('bloqueia uma organização cujo trial expirou', () => {
    const db = createTestDatabase();
    const organization = new OrganizationRepository(db).create('Empresa Expirada');
    const billing = new BillingService(db, { trialDays: -1 });

    billing.ensureTrial(organization.id);

    expect(billing.canUse(organization.id, 'catalog')).toBe(false);
  });

  it('ativa assinatura uma única vez e mantém o isolamento entre organizações', () => {
    const db = createTestDatabase();
    const organizations = new OrganizationRepository(db);
    const active = organizations.create('Empresa Ativa');
    const trial = organizations.create('Empresa Trial Isolada');
    const billing = new BillingService(db, { trialDays: -1 });
    billing.ensureTrial(active.id);
    billing.ensureTrial(trial.id);

    const activation = {
      provider: 'mercadopago',
      eventId: 'event-1',
      eventType: 'subscription.active',
      organizationId: active.id,
      providerCustomerId: 'customer-1',
      providerSubscriptionId: 'subscription-1',
      payload: { status: 'authorized' },
      planCode: 'UNLIMITED',
    };

    expect(billing.activateFromWebhook(activation as never)).toBe(true);
    expect(billing.activateFromWebhook({ ...activation } as never)).toBe(false);

    expect(billing.canUse(active.id, 'catalog')).toBe(true);
    expect(billing.canUse(trial.id, 'catalog')).toBe(false);
    expect(billing.account(active.id)?.status).toBe('ACTIVE');
    expect((billing.account(active.id) as unknown as { planCode: string }).planCode).toBe('UNLIMITED');
  });
});
