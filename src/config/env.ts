import 'dotenv/config';
import { z } from 'zod';
import { defaultBillingPlans, parseBillingPlans, type BillingPlanDefinition } from './billingPlans';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().default('./data/licitacoes.db'),
  SYNC_INTERVAL_MINUTES: z.coerce.number().int().positive().default(10),
  WORKER_LEASE_MS: z.coerce.number().int().positive().default(300_000),
  PNCP_BASE_URL: z.string().url().default('https://pncp.gov.br/api/consulta/v1'),
  OPEN_DATA_BASE_URL: z.string().url().default('https://dadosabertos.compras.gov.br'),
  PNCP_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),
  PNCP_MAX_RETRIES: z.coerce.number().int().min(0).default(3),
  RESEND_API_KEY: z.string().default(''),
  NOTIFICATION_EMAIL_FROM: z.string().default(''),
  VAPID_SUBJECT: z.string().default(''),
  VAPID_PUBLIC_KEY: z.string().default(''),
  VAPID_PRIVATE_KEY: z.string().default(''),
  MAX_NOTIFICATIONS_PER_HOUR: z.coerce.number().int().positive().default(100),
  AI_ENABLED: z.preprocess(parseBoolean, z.boolean().default(false)),
  OPENAI_API_KEY: z.string().default(''),
  OPENAI_MODEL_FAST: z.string().default('gpt-4o-mini'),
  OPENAI_MONTHLY_BUDGET_USD: z.coerce.number().min(0).default(0),
  BILLING_PROVIDER: z.enum(['mercadopago']).default('mercadopago'),
  MERCADOPAGO_ACCESS_TOKEN: z.string().default(''),
  MERCADOPAGO_WEBHOOK_SECRET: z.string().default(''),
  PUBLIC_APP_URL: z.string().url().default('http://localhost:3000'),
  BILLING_MONTHLY_PRICE_CENTS: z.coerce.number().int().positive().default(5_000),
  BILLING_TRIAL_DAYS: z.coerce.number().int().min(0).default(14),
  BILLING_PLANS_JSON: z.string().default(JSON.stringify(defaultBillingPlans)),
  MARKET_MIN_OBSERVATIONS: z.coerce.number().int().positive().default(5),
  MARKET_LOOKBACK_DAYS: z.coerce.number().int().positive().default(365),
  BEC_SP_ENABLED: z.preprocess(
    (value) => typeof value === 'string' ? ['true', '1', 'yes', 'on'].includes(value.trim().toLowerCase()) : value,
    z.boolean().default(false),
  ),
  BEC_SP_BASE_URL: z.string().url().default('https://www.bec.sp.gov.br'),
  BEC_SP_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),
  BEC_SP_MAX_RETRIES: z.coerce.number().int().min(0).default(3),
  PLATFORM_ADMIN_EMAILS: z.string().default(''),
});

export interface AppEnv {
  nodeEnv: 'development' | 'test' | 'production';
  databaseUrl: string;
  syncIntervalMinutes: number;
  workerLeaseMs: number;
  pncpBaseUrl: string;
  openDataBaseUrl: string;
  pncpTimeoutMs: number;
  pncpMaxRetries: number;
  resendApiKey: string;
  notificationEmailFrom: string;
  vapidSubject: string;
  vapidPublicKey: string;
  vapidPrivateKey: string;
  maxNotificationsPerHour: number;
  aiEnabled: boolean;
  openAiApiKey: string;
  openAiModelFast: string;
  openAiMonthlyBudgetUsd: number;
  billingProvider: 'mercadopago';
  mercadoPagoAccessToken: string;
  mercadoPagoWebhookSecret: string;
  publicAppUrl: string;
  billingMonthlyPriceCents: number;
  billingTrialDays: number;
  billingPlans: BillingPlanDefinition[];
  marketMinObservations: number;
  marketLookbackDays: number;
  becSpEnabled: boolean;
  becSpBaseUrl: string;
  becSpTimeoutMs: number;
  becSpMaxRetries: number;
  platformAdminEmails: string[];
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): AppEnv {
  const parsed = envSchema.parse(source);
  return {
    nodeEnv: parsed.NODE_ENV,
    databaseUrl: parsed.DATABASE_URL,
    syncIntervalMinutes: parsed.SYNC_INTERVAL_MINUTES,
    workerLeaseMs: parsed.WORKER_LEASE_MS,
    pncpBaseUrl: parsed.PNCP_BASE_URL,
    openDataBaseUrl: parsed.OPEN_DATA_BASE_URL,
    pncpTimeoutMs: parsed.PNCP_TIMEOUT_MS,
    pncpMaxRetries: parsed.PNCP_MAX_RETRIES,
    resendApiKey: parsed.RESEND_API_KEY,
    notificationEmailFrom: parsed.NOTIFICATION_EMAIL_FROM,
    vapidSubject: parsed.VAPID_SUBJECT,
    vapidPublicKey: parsed.VAPID_PUBLIC_KEY,
    vapidPrivateKey: parsed.VAPID_PRIVATE_KEY,
    maxNotificationsPerHour: parsed.MAX_NOTIFICATIONS_PER_HOUR,
    aiEnabled: parsed.AI_ENABLED,
    openAiApiKey: parsed.OPENAI_API_KEY,
    openAiModelFast: parsed.OPENAI_MODEL_FAST,
    openAiMonthlyBudgetUsd: parsed.OPENAI_MONTHLY_BUDGET_USD,
    billingProvider: parsed.BILLING_PROVIDER,
    mercadoPagoAccessToken: parsed.MERCADOPAGO_ACCESS_TOKEN,
    mercadoPagoWebhookSecret: parsed.MERCADOPAGO_WEBHOOK_SECRET,
    publicAppUrl: parsed.PUBLIC_APP_URL,
    billingMonthlyPriceCents: parsed.BILLING_MONTHLY_PRICE_CENTS,
    billingTrialDays: parsed.BILLING_TRIAL_DAYS,
    billingPlans: parseBillingPlans(parsed.BILLING_PLANS_JSON),
    marketMinObservations: parsed.MARKET_MIN_OBSERVATIONS,
    marketLookbackDays: parsed.MARKET_LOOKBACK_DAYS,
    becSpEnabled: parsed.BEC_SP_ENABLED,
    becSpBaseUrl: parsed.BEC_SP_BASE_URL,
    becSpTimeoutMs: parsed.BEC_SP_TIMEOUT_MS,
    becSpMaxRetries: parsed.BEC_SP_MAX_RETRIES,
    platformAdminEmails: parsed.PLATFORM_ADMIN_EMAILS.split(',').map((email) => email.trim().toLowerCase()).filter(Boolean),
  };
}

function parseBoolean(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const normalized = value.trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
  if (['false', '0', 'no', 'off', ''].includes(normalized)) return false;
  return value;
}
