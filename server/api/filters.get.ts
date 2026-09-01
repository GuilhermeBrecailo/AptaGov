import { defineEventHandler } from 'h3';
import { loadFilters } from '../../src/config/filters';
import { OrganizationFilterRepository } from '../../src/repositories/organizationFilterRepository';
import { getAppDatabase, requireActiveBilling } from '../utils/app';

export default defineEventHandler((event) => {
  const context = requireActiveBilling(event, 'catalog');
  const repository = new OrganizationFilterRepository(getAppDatabase());
  return repository.find(context.organization.id) ?? repository.save(context.organization.id, loadFilters());
});
