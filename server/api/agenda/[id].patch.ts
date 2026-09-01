import { createError, defineEventHandler, getRouterParam, readBody } from 'h3';
import type { SqliteDatabase } from '../../../src/db/database';
import type { OpportunityReminderPatch } from '../../../src/repositories/opportunityReminderRepository';
import { AgendaService, REMINDER_STATUSES } from '../../../src/services/agendaService';
import { getAppDatabase, requireActiveBilling } from '../../utils/app';

export async function handleAgendaPatch(input: {
  service?: AgendaService;
  db: SqliteDatabase;
  organizationId: number;
  reminderId: number;
  body: OpportunityReminderPatch;
}) {
  if (!Number.isInteger(input.reminderId)
    || (input.body.status !== undefined && !REMINDER_STATUSES.includes(input.body.status))
    || (input.body.dueAt !== undefined && Number.isNaN(Date.parse(input.body.dueAt)))) {
    throw createError({ statusCode: 400, statusMessage: 'Atualização de lembrete inválida' });
  }
  const reminder = (input.service ?? new AgendaService(input.db)).update(input.organizationId, input.reminderId, input.body);
  if (!reminder) throw createError({ statusCode: 404, message: 'Lembrete não encontrado' });
  return reminder;
}

export default defineEventHandler(async (event) => {
  const context = requireActiveBilling(event, 'kanban');
  return handleAgendaPatch({
    db: getAppDatabase(),
    organizationId: context.organization.id,
    reminderId: Number(getRouterParam(event, 'id')),
    body: await readBody<OpportunityReminderPatch>(event),
  });
});
