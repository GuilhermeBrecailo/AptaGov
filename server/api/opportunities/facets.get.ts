import { defineEventHandler, getQuery } from 'h3';
import { listOpportunityFacets } from '../../../src/repositories/opportunityFacets';
import { getAppDatabase, requireActiveBilling } from '../../utils/app';

export default defineEventHandler((event) => {
  requireActiveBilling(event, 'catalog');
  const { state } = getQuery(event);
  const trimmed = typeof state === 'string' ? state.trim() : '';
  return listOpportunityFacets(getAppDatabase(), trimmed || undefined);
});
