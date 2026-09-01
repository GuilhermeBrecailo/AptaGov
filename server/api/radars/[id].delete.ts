import { createError, defineEventHandler, getRouterParam } from 'h3';
import { getSavedSearchService, requireActiveBilling } from '../../utils/app';

export default defineEventHandler((event) => {
  const context = requireActiveBilling(event, 'catalog');
  const id = Number(getRouterParam(event, 'id'));
  if (!Number.isInteger(id) || id < 1) throw createError({ statusCode: 400, statusMessage: 'Radar inválido' });
  if (!getSavedSearchService().remove(context.organization.id, id)) throw createError({ statusCode: 404, statusMessage: 'Radar não encontrado' });
  return { deleted: true };
});
