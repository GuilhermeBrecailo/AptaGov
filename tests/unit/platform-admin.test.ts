import { describe, expect, it } from 'vitest';
import { createTestDatabase } from '../../src/db/database';
import { BillingService } from '../../src/services/billingService';
import { OrganizationRepository } from '../../src/repositories/organizationRepository';
import { UserRepository } from '../../src/repositories/userRepository';

describe('painel administrativo da plataforma', () => {
  it('mantém o plano escolhido em uma coluna compatível com contas existentes', () => {
    const db = createTestDatabase();
    const columns = db.prepare('PRAGMA table_info(billing_accounts)').all() as Array<{ name: string }>;

    expect(columns.map((column) => column.name)).toContain('plan_code');
  });

  it('autoriza somente e-mails administrativos configurados', async () => {
    const loaded = await import('../../src/auth/' + 'platformAdmin').catch(() => null);
    expect(loaded).not.toBeNull();
    if (!loaded) return;

    expect(loaded.isPlatformAdminEmail('brecailo3@gmail.com', 'brecailo3@gmail.com')).toBe(true);
    expect(loaded.isPlatformAdminEmail('cliente@example.com', 'brecailo3@gmail.com')).toBe(false);
  });

  it('consolida empresas, planos, assinaturas e receita mensal estimada', async () => {
    const db = createTestDatabase();
    const users = new UserRepository(db);
    const organizations = new OrganizationRepository(db);
    const ownerA = users.create({ name: 'Dono A', email: 'owner-a@example.com', passwordHash: 'hash' });
    const ownerB = users.create({ name: 'Dono B', email: 'owner-b@example.com', passwordHash: 'hash' });
    const active = organizations.create('Empresa Ativa');
    const trial = organizations.create('Empresa Trial');
    organizations.addMember(active.id, ownerA.id, 'OWNER');
    organizations.addMember(trial.id, ownerB.id, 'OWNER');
    const billing = new BillingService(db, { trialDays: 14 });
    billing.ensureTrial(active.id);
    billing.ensureTrial(trial.id);
    billing.activateFromWebhook({
      provider: 'mercadopago',
      eventId: 'admin-event-1',
      eventType: 'subscription.active',
      organizationId: active.id,
      providerCustomerId: 'customer-1',
      providerSubscriptionId: 'subscription-1',
      payload: { status: 'authorized' },
      planCode: 'BUSINESS',
    } as never);

    const loaded = await import('../../src/services/' + 'platformAdminService').catch(() => null);
    expect(loaded).not.toBeNull();
    if (!loaded) return;

    const env = (await import('../../src/config/env')).loadEnv({ NODE_ENV: 'test', DATABASE_URL: ':memory:' });
    const metrics = loaded.buildPlatformAdminMetrics(db, env.billingPlans);
    expect(metrics.summary.organizations).toBe(2);
    expect(metrics.summary.activeSubscriptions).toBe(1);
    expect(metrics.summary.trialingOrganizations).toBe(1);
    expect(metrics.summary.estimatedMrrCents).toBe(19_900);
    expect(metrics.plans.find((plan: { code: string }) => plan.code === 'BUSINESS')?.organizationCount).toBe(1);
    expect(metrics.recentOrganizations[0]?.ownerEmail).toBe('owner-b@example.com');
  });
});
