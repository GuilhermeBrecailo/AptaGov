import { defineEventHandler } from 'h3';
import { getSavedSearchService, requireActiveBilling } from '../utils/app';

export default defineEventHandler((event) => {
  const context = requireActiveBilling(event, 'catalog');
  const service = getSavedSearchService();
  return { data: service.list(context.organization.id), limit: service.limit(context.organization.id) };
});
