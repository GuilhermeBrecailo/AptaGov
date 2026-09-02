import { createError, defineEventHandler, getQuery } from 'h3';
import { loadEnv } from '../../src/config/env';
import type { SqliteDatabase } from '../../src/db/database';
import { MarketRepository } from '../../src/repositories/marketRepository';
import { MarketIntelligenceService, type MarketSummaryQuery } from '../../src/services/marketIntelligenceService';
import { getAppDatabase, requireActiveBilling } from '../utils/app';

export function handleMarketGet(input: {
  service?: MarketIntelligenceService;
  db: SqliteDatabase;
  organizationId: number;
  query: Record<string, unknown>;
}) {
  const service = input.service ?? createMarketService(input.db);
  return service.getMarketSummary(parseMarketQuery(input.query));
}

export default defineEventHandler((event) => {
  const context = requireActiveBilling(event, 'catalog');
  return handleMarketGet({
    db: getAppDatabase(),
    organizationId: context.organization.id,
    query: getQuery(event) as Record<string, unknown>,
  });
});

export function createMarketService(db: SqliteDatabase): MarketIntelligenceService {
  const env = loadEnv();
  return new MarketIntelligenceService(new MarketRepository(db), {
    minimumObservations: env.marketMinObservations,
    lookbackDays: env.marketLookbackDays,
  });
}

export function parseMarketQuery(query: Record<string, unknown>): MarketSummaryQuery {
  const dateFrom = parseDate(query.dateFrom ?? query.from, false);
  const dateTo = parseDate(query.dateTo ?? query.to, true);
  if (dateFrom && dateTo && dateFrom > dateTo) {
    throw createError({ statusCode: 400, message: 'Período de mercado inválido' });
  }
  return {
    dateFrom,
    dateTo,
    state: optionalString(query.state),
    organization: optionalString(query.organization),
    normalizedDescription: optionalString(query.normalizedDescription ?? query.description),
    itemCode: optionalString(query.itemCode),
  };
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function parseDate(value: unknown, endOfDay: boolean): string | undefined {
  const text = optionalString(value);
  if (!text) return undefined;
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(text)
    ? `${text}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z`
    : text;
  if (Number.isNaN(Date.parse(normalized))) throw createError({ statusCode: 400, message: 'Data do mercado inválida' });
  return new Date(normalized).toISOString();
}
