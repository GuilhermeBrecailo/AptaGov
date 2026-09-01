import { createError, defineEventHandler, readBody } from 'h3';
import { z } from 'zod';
import { billingPlanCodes, findBillingPlan } from '../../../src/config/billingPlans';
import { loadEnv } from '../../../src/config/env';
import { MercadoPagoBillingProvider } from '../../../src/integrations/billing/MercadoPagoBillingProvider';
import { getRuntime, requireAuth } from '../../utils/app';

export default defineEventHandler(async (event) => {
  const context = requireAuth(event);
  if (context.role !== 'OWNER') throw createError({ statusCode: 403, statusMessage: 'Somente o proprietário pode gerenciar a assinatura' });
  const env = loadEnv();
  const runtime = getRuntime();
  const body = await readBody(event);
  const requestedPlan = body && typeof body === 'object' && 'plan' in body ? body.plan : 'STARTER';
  const parsedPlan = z.enum(billingPlanCodes).safeParse(requestedPlan);
  if (!parsedPlan.success) throw createError({ statusCode: 400, statusMessage: 'Plano de cobrança inválido' });
  const account = runtime.billing.account(context.organization.id);
  if (account?.status === 'ACTIVE') throw createError({ statusCode: 409, statusMessage: 'A assinatura desta organização já está ativa' });

  try {
    const plan = findBillingPlan(env.billingPlans, parsedPlan.data);
    const provider = new MercadoPagoBillingProvider(env.mercadoPagoAccessToken, env.publicAppUrl, plan);
    const checkout = await provider.createSubscription({ organizationId: context.organization.id, payerEmail: context.user.email });
    runtime.billing.linkCheckout(context.organization.id, env.billingProvider, checkout.providerSubscriptionId, plan.code);
    return checkout;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Não foi possível iniciar a assinatura';
    throw createError({ statusCode: message.includes('não configuradas') ? 503 : 502, statusMessage: message });
  }
});
