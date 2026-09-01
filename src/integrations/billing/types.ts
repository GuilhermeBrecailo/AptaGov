import type { BillingPlanCode } from '../../config/billingPlans';

export interface CreateSubscriptionInput {
  organizationId: number;
  payerEmail: string;
}

export interface CreatedSubscription {
  providerSubscriptionId: string;
  checkoutUrl: string;
  planCode: BillingPlanCode;
}

export interface ProviderSubscription {
  id: string;
  externalReference: string | null;
  status: string;
  payerId: string | null;
  approvedAt: string | null;
  nextPaymentAt: string | null;
  transactionAmountCents: number | null;
}
