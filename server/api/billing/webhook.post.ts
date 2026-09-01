import { createError, defineEventHandler, getHeader, getQuery, readBody } from 'h3';
import { z } from 'zod';
import { loadEnv } from '../../../src/config/env';
import { isBillingPlanCode, type BillingPlanCode } from '../../../src/config/billingPlans';
import { MercadoPagoBillingProvider, verifyWebhookSignature } from '../../../src/integrations/billing/MercadoPagoBillingProvider';
import { getRuntime } from '../../utils/app';

const webhookSchema = z.object({
  id: z.union([z.string(), z.number()]),
  type: z.string(),
  action: z.string().optional(),
  data: z.object({ id: z.union([z.string(), z.number()]) }),
});

export default defineEventHandler(async (event) => {
  const env = loadEnv();
  if (!env.mercadoPagoAccessToken || !env.mercadoPagoWebhookSecret) {
    throw createError({ statusCode: 503, statusMessage: 'Webhook do Mercado Pago ainda não está configurado' });
  }
  const parsed = webhookSchema.safeParse(await readBody(event));
  if (!parsed.success) throw createError({ statusCode: 400, statusMessage: 'Webhook de cobrança inválido' });
  if (parsed.data.type !== 'subscription_preapproval') return { received: true, ignored: true };

  const query = getQuery(event);
  const dataId = String(parsed.data.data.id);
  const queryDataId = typeof query['data.id'] === 'string' ? query['data.id'] : dataId;
  const validSignature = verifyWebhookSignature(
    getHeader(event, 'x-signature'),
    getHeader(event, 'x-request-id'),
    queryDataId,
    env.mercadoPagoWebhookSecret,
  );
  if (!validSignature) throw createError({ statusCode: 401, statusMessage: 'Assinatura do webhook inválida' });

  const subscription = await new MercadoPagoBillingProvider(env.mercadoPagoAccessToken, env.publicAppUrl, env.billingMonthlyPriceCents)
    .getSubscription(dataId);
  const organizationId = Number(subscription.externalReference?.split(':')[0]);
  if (!Number.isInteger(organizationId) || organizationId <= 0) return { received: true, ignored: true };
  const planCode = parsePlanCode(subscription.externalReference);
  getRuntime().billing.syncFromWebhook({
    provider: env.billingProvider,
    eventId: String(parsed.data.id),
    eventType: parsed.data.action ?? parsed.data.type,
    organizationId,
    payload: parsed.data,
    providerCustomerId: subscription.payerId,
    providerSubscriptionId: subscription.id,
    subscriptionStatus: mapSubscriptionStatus(subscription.status),
    currentPeriodEndsAt: subscription.nextPaymentAt,
    planCode,
  });
  return { received: true };
});

function mapSubscriptionStatus(status: string): 'ACTIVE' | 'PAST_DUE' | 'CANCELED' | 'INACTIVE' {
  if (status === 'authorized' || status === 'active') return 'ACTIVE';
  if (status === 'paused') return 'PAST_DUE';
  if (status === 'cancelled' || status === 'canceled') return 'CANCELED';
  return 'INACTIVE';
}

function parsePlanCode(externalReference: string | null): BillingPlanCode {
  const value = externalReference?.split(':')[1];
  return isBillingPlanCode(value) ? value : 'STARTER';
}
