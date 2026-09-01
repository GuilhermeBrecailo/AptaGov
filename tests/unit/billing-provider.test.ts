import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MercadoPagoBillingProvider,
  createWebhookSignature,
  verifyWebhookSignature,
} from '../../src/integrations/billing/MercadoPagoBillingProvider';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('adaptador de cobrança do Mercado Pago', () => {
  it('bloqueia checkout sem token e sem expor segredo', async () => {
    const provider = new MercadoPagoBillingProvider('', 'http://localhost:3000', 19_900);

    await expect(provider.createSubscription({ organizationId: 7, payerEmail: 'empresa@example.com' }))
      .rejects.toThrow('Credenciais do Mercado Pago não configuradas');
  });

  it('cria assinatura mensal e retorna o link do checkout', async () => {
    let request: Request | undefined;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      request = new Request(input, init);
      return new Response(JSON.stringify({ id: 'preapproval-1', init_point: 'https://mercadopago.com/checkout/1' }), { status: 201 });
    }));
    const provider = new MercadoPagoBillingProvider('token-secret', 'https://radar.example.com', {
      code: 'BUSINESS',
      name: 'Empresarial',
      description: 'Para equipes',
      priceCents: 19_900,
      maxUsers: 15,
      maxOrganizations: 1,
      monthlyAlerts: 5_000,
    } as never);

    const result = await provider.createSubscription({ organizationId: 7, payerEmail: 'empresa@example.com' });

    expect(result).toEqual({ providerSubscriptionId: 'preapproval-1', checkoutUrl: 'https://mercadopago.com/checkout/1', planCode: 'BUSINESS' });
    expect(request?.url).toBe('https://api.mercadopago.com/preapproval');
    expect(request?.headers.get('authorization')).toBe('Bearer token-secret');
    expect(await request?.json()).toMatchObject({
      reason: 'Radar de Licitações - Empresarial',
      external_reference: '7:BUSINESS',
      payer_email: 'empresa@example.com',
      auto_recurring: { frequency: 1, frequency_type: 'months', transaction_amount: 199 },
    });
  });

  it('valida assinatura HMAC e rejeita webhook adulterado', () => {
    const secret = 'webhook-secret';
    const signature = createWebhookSignature(secret, 'notification-1', 'request-1', 1_700_000_000);

    expect(verifyWebhookSignature(signature, 'request-1', 'notification-1', secret, 1_700_000_000)).toBe(true);
    expect(verifyWebhookSignature(signature, 'request-1', 'notification-2', secret, 1_700_000_000)).toBe(false);
  });
});
