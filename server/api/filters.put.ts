import { createError, defineEventHandler, readBody } from 'h3';
import { filterConfigSchema } from '../../src/config/filters';
import { OrganizationFilterRepository } from '../../src/repositories/organizationFilterRepository';
import { classifyOrganizationOpportunities } from '../../src/services/scoring/classificationService';
import { getAppDatabase, getRuntime, requireActiveBilling } from '../utils/app';

export default defineEventHandler(async (event) => {
  const context = requireActiveBilling(event, 'catalog');
  const body = await readBody(event);
  const parsed = filterConfigSchema.safeParse(body);
  if (!parsed.success) throw createError({ statusCode: 400, statusMessage: 'Configuração de filtros inválida' });
  const saved = new OrganizationFilterRepository(getAppDatabase()).save(context.organization.id, parsed.data);
  await classifyOrganizationOpportunities(getRuntime().opportunities, context.organization.id, saved);
  return saved;
});
