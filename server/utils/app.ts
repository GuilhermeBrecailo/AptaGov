import { loadEnv } from '../../src/config/env';
import { createDatabase, type SqliteDatabase } from '../../src/db/database';
import { WorkerRuntime } from '../../src/workerRuntime';
import type { BillingFeature } from '../../src/services/billingService';
import { getAuthContext } from '../../src/auth/service';
import { isPlatformAdminEmail } from '../../src/auth/platformAdmin';
import { SessionRepository } from '../../src/repositories/sessionRepository';
import { createError, getCookie, type H3Event } from 'h3';
import { SavedSearchService } from '../../src/services/savedSearchService';
import Anthropic from '@anthropic-ai/sdk';
import { ClaudeEditalExtractor } from '../../src/services/edital/claudeExtractor';
import { EditalAnalysisService } from '../../src/services/edital/editalAnalysisService';
import { PncpDocumentClient } from '../../src/services/edital/pncpDocuments';

let runtime: WorkerRuntime | undefined;
let database: SqliteDatabase | undefined;
let editalAnalysisService: EditalAnalysisService | undefined;

export const SESSION_COOKIE = 'radar_session';

export function getAppDatabase(): SqliteDatabase {
  if (!database) {
    const env = loadEnv();
    database = createDatabase(env.databaseUrl);
  }
  return database;
}

export function getRuntime(): WorkerRuntime {
  if (!runtime) {
    const env = loadEnv();
    runtime = new WorkerRuntime(env, getAppDatabase());
  }
  return runtime;
}

export function getSavedSearchService(): SavedSearchService {
  const env = loadEnv();
  return new SavedSearchService(getAppDatabase(), env.billingPlans, { trialDays: env.billingTrialDays });
}

export function getEditalAnalysisService(): EditalAnalysisService {
  if (!editalAnalysisService) {
    const env = loadEnv();
    const extractor = env.anthropicApiKey
      ? new ClaudeEditalExtractor({ client: new Anthropic({ apiKey: env.anthropicApiKey }), model: env.editalAnalysisModel })
      : null;
    editalAnalysisService = new EditalAnalysisService({
      db: getAppDatabase(),
      env,
      extractor,
      documents: new PncpDocumentClient()
    });
  }
  return editalAnalysisService;
}

export function requireAuth(event: H3Event) {
  const token = getCookie(event, SESSION_COOKIE);
  const context = getAuthContext(getAppDatabase(), token);
  if (!context) throw createError({ statusCode: 401, statusMessage: 'Faça login para continuar' });
  return context;
}

export function requirePlatformAdmin(event: H3Event) {
  const context = requireAuth(event);
  const env = loadEnv();
  if (!isPlatformAdminEmail(context.user.email, env.platformAdminEmails)) {
    throw createError({ statusCode: 403, statusMessage: 'Acesso restrito ao administrador da plataforma' });
  }
  return context;
}

export function requireActiveBilling(event: H3Event, feature: BillingFeature) {
  const context = requireAuth(event);
  if (!getRuntime().billing.canUse(context.organization.id, feature)) {
    throw createError({ statusCode: 402, statusMessage: 'Seu período de acesso terminou. Ative o plano inicial para continuar.' });
  }
  return context;
}

export function revokeSession(token: string | undefined): void {
  if (token) new SessionRepository(getAppDatabase()).revoke(token);
}
