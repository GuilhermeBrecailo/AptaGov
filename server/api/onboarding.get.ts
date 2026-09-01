import { defineEventHandler } from 'h3';
import { loadFilters } from '../../src/config/filters';
import { OrganizationFilterRepository } from '../../src/repositories/organizationFilterRepository';
import { OrganizationRepository } from '../../src/repositories/organizationRepository';
import { getAppDatabase, getSavedSearchService, requireAuth } from '../utils/app';

export default defineEventHandler((event) => {
  const context = requireAuth(event);
  const db = getAppDatabase();
  const organization = new OrganizationRepository(db);
  const radars = getSavedSearchService().list(context.organization.id);
  return {
    completed: Boolean(organization.onboardingCompletedAt(context.organization.id)),
    completedAt: organization.onboardingCompletedAt(context.organization.id) ?? null,
    filters: new OrganizationFilterRepository(db).find(context.organization.id) ?? loadFilters(),
    radars,
  };
});
