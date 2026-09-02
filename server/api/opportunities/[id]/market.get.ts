import { createError, defineEventHandler, getRouterParam } from 'h3';
import type { SqliteDatabase } from '../../../../src/db/database';
import { OpportunityRepository } from '../../../../src/repositories/opportunityRepository';
import {
  extractMarketIdentity,
  MarketIntelligenceService,
  type MarketIdentity,
  type MarketSummary,
} from '../../../../src/services/marketIntelligenceService';
import { createMarketService } from '../../market.get';
import { getAppDatabase, requireActiveBilling } from '../../../utils/app';

export interface OpportunityMarketResponse {
  opportunityId: number;
  identity: MarketIdentity;
  state: 'READY' | 'INSUFFICIENT_DATA';
  comparison: MarketSummary | null;
  message: string | null;
}

export function handleOpportunityMarketGet(input: {
  opportunities: OpportunityRepository;
  service?: MarketIntelligenceService;
  db?: SqliteDatabase;
  organizationId: number;
  opportunityId: number;
}): OpportunityMarketResponse {
  const catalog = input.opportunities.listCatalog({
    organizationId: input.organizationId,
    opportunityId: input.opportunityId,
    page: 1,
    pageSize: 1,
    authorizedOnly: true,
    hideNotRelevant: false,
  });
  const opportunity = catalog.data[0];
  if (!opportunity) throw createError({ statusCode: 404, message: 'Oportunidade não encontrada' });
  const identity = extractMarketIdentity(opportunity);
  if (!identity.itemCode || !identity.normalizedDescription || !identity.unit) {
    return {
      opportunityId: input.opportunityId,
      identity,
      state: 'INSUFFICIENT_DATA',
      comparison: null,
      message: 'Dados insuficientes para comparação',
    };
  }
  const service = input.service ?? createMarketService(input.db as SqliteDatabase);
  const comparison = service.getMarketSummary({
    itemCode: identity.itemCode,
    normalizedDescription: identity.normalizedDescription,
    unit: identity.unit,
  });
  return {
    opportunityId: input.opportunityId,
    identity,
    state: comparison.state,
    comparison: comparison.state === 'READY' ? comparison : null,
    message: comparison.state === 'READY' ? null : 'Dados insuficientes para comparação',
  };
}

export default defineEventHandler((event) => {
  const context = requireActiveBilling(event, 'catalog');
  const opportunityId = Number(getRouterParam(event, 'id'));
  if (!Number.isInteger(opportunityId) || opportunityId <= 0) {
    throw createError({ statusCode: 400, message: 'Oportunidade inválida' });
  }
  const db = getAppDatabase();
  return handleOpportunityMarketGet({
    db,
    opportunities: new OpportunityRepository(db),
    organizationId: context.organization.id,
    opportunityId,
  });
});
