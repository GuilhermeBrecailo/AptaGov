import { defineEventHandler } from 'h3';
import { CompanyProfileRepository } from '../../src/repositories/companyProfileRepository';
import { getAppDatabase, requireActiveBilling } from '../utils/app';

export default defineEventHandler((event) => {
  const context = requireActiveBilling(event, 'catalog');
  return new CompanyProfileRepository(getAppDatabase()).find(context.organization.id);
});
