import { createError, defineEventHandler, readBody } from 'h3';
import { filterConfigSchema } from '../../src/config/filters';
import { getSavedSearchService, requireActiveBilling } from '../utils/app';

export default defineEventHandler(async (event) => {
  const context = requireActiveBilling(event, 'catalog');
  const body = await readBody<{ name?: unknown; filters?: unknown; notificationsEnabled?: unknown }>(event);
  const name = typeof body.name === 'string' ? body.name : '';
  if (body.notificationsEnabled !== undefined && typeof body.notificationsEnabled !== 'boolean') {
    throw createError({ statusCode: 400, statusMessage: 'A preferência de notificações do radar é inválida' });
  }
  const filters = filterConfigSchema.safeParse(body.filters);
  if (!filters.success) throw createError({ statusCode: 400, statusMessage: 'Configure os filtros do radar antes de salvar' });
  try {
    return getSavedSearchService().create(context.organization.id, name, filters.data, body.notificationsEnabled !== false);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Não foi possível criar o radar';
    throw createError({ statusCode: message.includes('limite') ? 402 : 400, statusMessage: message });
  }
});
