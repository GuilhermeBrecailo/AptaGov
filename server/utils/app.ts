import { loadEnv } from '../../src/config/env';
import { createDatabase, type SqliteDatabase } from '../../src/db/database';
import { WorkerRuntime } from '../../src/workerRuntime';
import type { BillingFeature } from '../../src/services/billingService';
import { getAuthContext } from '../../src/auth/service';
import { SessionRepository } from '../../src/repositories/sessionRepository';
import { createError, getCookie, type H3Event } from 'h3';

let runtime: WorkerRuntime | undefined;
let database: SqliteDatabase | undefined;

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

export function requireAuth(event: H3Event) {
  const token = getCookie(event, SESSION_COOKIE);
  const context = getAuthContext(getAppDatabase(), token);
  if (!context) throw createError({ statusCode: 401, statusMessage: 'Faça login para continuar' });
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
