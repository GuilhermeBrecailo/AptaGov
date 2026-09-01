import { createHmac, timingSafeEqual } from 'node:crypto';
import type { BillingPlanDefinition } from '../../config/billingPlans';
import type { CreateSubscriptionInput, CreatedSubscription, ProviderSubscription } from './types';

const MERCADO_PAGO_API = 'https://api.mercadopago.com';

export class MercadoPagoBillingProvider {
  constructor(
    private readonly accessToken: string,
    private readonly appUrl: string,
    planOrPrice: BillingPlanDefinition | number,
  ) {
    this.plan = typeof planOrPrice === 'number'
      ? { code: 'STARTER', name: 'plano inicial', description: '', priceCents: planOrPrice, maxUsers: 1, maxOrganizations: 1, monthlyAlerts: 300 }
      : planOrPrice;
  }

  private readonly plan: BillingPlanDefinition;

  async createSubscription(input: CreateSubscriptionInput): Promise<CreatedSubscription> {
    this.ensureConfigured();
    const response = await fetch(`${MERCADO_PAGO_API}/preapproval`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        reason: `Radar de Licitações - ${this.plan.name}`,
        external_reference: `${input.organizationId}:${this.plan.code}`,
        payer_email: input.payerEmail,
        auto_recurring: {
          frequency: 1,
          frequency_type: 'months',
          transaction_amount: this.plan.priceCents / 100,
          currency_id: 'BRL',
        },
        back_url: `${this.appUrl.replace(/\/$/, '')}/?billing=return`,
        notification_url: `${this.appUrl.replace(/\/$/, '')}/api/billing/webhook`,
        status: 'pending',
      }),
    });
    if (!response.ok) throw new Error(`Mercado Pago indisponível (HTTP ${response.status})`);
    const data = await response.json() as { id?: string; init_point?: string; sandbox_init_point?: string };
    const checkoutUrl = data.init_point ?? data.sandbox_init_point;
    if (!data.id || !checkoutUrl) throw new Error('Mercado Pago retornou um checkout incompleto');
    return { providerSubscriptionId: data.id, checkoutUrl, planCode: this.plan.code };
  }

  async getSubscription(subscriptionId: string): Promise<ProviderSubscription> {
    this.ensureConfigured();
    const response = await fetch(`${MERCADO_PAGO_API}/preapproval/${encodeURIComponent(subscriptionId)}`, {
      headers: { Authorization: `Bearer ${this.accessToken}` },
    });
    if (!response.ok) throw new Error(`Mercado Pago indisponível (HTTP ${response.status})`);
    const data = await response.json() as {
      id?: string;
      external_reference?: string;
      status?: string;
      payer_id?: number | string;
      date_approved?: string;
      next_payment_date?: string;
      auto_recurring?: { transaction_amount?: number };
    };
    if (!data.id || !data.status) throw new Error('Mercado Pago retornou uma assinatura incompleta');
    return {
      id: data.id,
      externalReference: data.external_reference ?? null,
      status: data.status,
      payerId: data.payer_id === undefined ? null : String(data.payer_id),
      approvedAt: data.date_approved ?? null,
      nextPaymentAt: data.next_payment_date ?? null,
      transactionAmountCents: typeof data.auto_recurring?.transaction_amount === 'number'
        ? Math.round(data.auto_recurring.transaction_amount * 100)
        : null,
    };
  }

  private ensureConfigured(): void {
    if (!this.accessToken || !this.appUrl || this.plan.priceCents <= 0) throw new Error('Credenciais do Mercado Pago não configuradas');
  }
}

export function createWebhookSignature(secret: string, dataId: string, requestId: string, timestamp: number): string {
  const manifest = `id:${dataId};request-id:${requestId};ts:${timestamp};`;
  const digest = createHmac('sha256', secret).update(manifest).digest('hex');
  return `ts=${timestamp},v1=${digest}`;
}

export function verifyWebhookSignature(
  signatureHeader: string | undefined,
  requestId: string | undefined,
  dataId: string,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
  maxAgeSeconds = 300,
): boolean {
  if (!signatureHeader || !requestId || !dataId || !secret) return false;
  const values = Object.fromEntries(signatureHeader.split(',').map((part) => part.trim().split('='))) as { ts?: string; v1?: string };
  const timestamp = Number(values.ts);
  if (!values.v1 || !Number.isInteger(timestamp) || Math.abs(nowSeconds - timestamp) > maxAgeSeconds) return false;
  const expected = createWebhookSignature(secret, dataId, requestId, timestamp).split('v1=')[1];
  if (!expected || expected.length !== values.v1.length) return false;
  return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(values.v1, 'hex'));
}
