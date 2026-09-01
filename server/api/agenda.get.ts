import { createError, defineEventHandler, getQuery } from 'h3';
import type { SqliteDatabase } from '../../src/db/database';
import { AgendaService } from '../../src/services/agendaService';
import { getAppDatabase, requireActiveBilling } from '../utils/app';

export function handleAgendaGet(input: {
  service?: AgendaService;
  db: SqliteDatabase;
  organizationId: number;
  query: { from?: unknown; to?: unknown };
}) {
  const from = parseDate(input.query.from, 'Período inicial inválido');
  const to = parseDate(input.query.to, 'Período final inválido');
  if (from > to) throw createError({ statusCode: 400, statusMessage: 'Período da agenda inválido' });
  return (input.service ?? new AgendaService(input.db)).list(input.organizationId, { from, to });
}

export default defineEventHandler((event) => {
  const context = requireActiveBilling(event, 'kanban');
  return handleAgendaGet({
    db: getAppDatabase(),
    organizationId: context.organization.id,
    query: getQuery(event),
  });
});

function parseDate(value: unknown, message: string): string {
  if (typeof value !== 'string' || !value || Number.isNaN(Date.parse(value))) {
    throw createError({ statusCode: 400, statusMessage: message });
  }
  return value;
}
