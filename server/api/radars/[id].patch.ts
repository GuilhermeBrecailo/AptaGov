import { createError, defineEventHandler, getRouterParam, readBody } from 'h3';
import { filterConfigSchema } from '../../../src/config/filters';
import { getSavedSearchService, requireActiveBilling } from '../../utils/app';

export default defineEventHandler(async (event) => {
  const context = requireActiveBilling(event, 'catalog');
  const id = parseId(getRouterParam(event, 'id'));
  const body = await readBody<{ name?: unknown; filters?: unknown; enabled?: unknown; notificationsEnabled?: unknown }>(event);
  const changes: { name?: string; filters?: ReturnType<typeof filterConfigSchema.parse>; enabled?: boolean; notificationsEnabled?: boolean } = {};
  if (body.name !== undefined) {
    if (typeof body.name !== 'string') throw createError({ statusCode: 400, statusMessage: 'Nome de radar inválido' });
    changes.name = body.name;
  }
  if (body.filters !== undefined) {
    const parsed = filterConfigSchema.safeParse(body.filters);
    if (!parsed.success) throw createError({ statusCode: 400, statusMessage: 'Configuração de filtros inválida' });
    changes.filters = parsed.data;
  }
  if (body.enabled !== undefined) {
    if (typeof body.enabled !== 'boolean') throw createError({ statusCode: 400, statusMessage: 'Status do radar inválido' });
    changes.enabled = body.enabled;
  }
  if (body.notificationsEnabled !== undefined) {
    if (typeof body.notificationsEnabled !== 'boolean') throw createError({ statusCode: 400, statusMessage: 'A preferência de notificações do radar é inválida' });
    changes.notificationsEnabled = body.notificationsEnabled;
  }
  try {
    const radar = getSavedSearchService().update(context.organization.id, id, changes);
    if (!radar) throw createError({ statusCode: 404, statusMessage: 'Radar não encontrado' });
    return radar;
  } catch (error) {
    if (error && typeof error === 'object' && 'statusCode' in error) throw error;
    throw createError({ statusCode: 400, statusMessage: error instanceof Error ? error.message : 'Não foi possível atualizar o radar' });
  }
});

function parseId(value: string | undefined): number {
  const id = Number(value);
  if (!Number.isInteger(id) || id < 1) throw createError({ statusCode: 400, statusMessage: 'Radar inválido' });
  return id;
}
