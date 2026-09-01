import { createError, defineEventHandler, readBody } from 'h3';
import type { SqliteDatabase } from '../../src/db/database';
import type { ReminderType } from '../../src/domain/operationalTypes';
import { AgendaService, REMINDER_TYPES } from '../../src/services/agendaService';
import { getAppDatabase, requireActiveBilling } from '../utils/app';

interface AgendaPostBody {
  opportunityId?: number;
  type?: ReminderType;
  title?: string;
  dueAt?: string;
  note?: string | null;
}

export async function handleAgendaPost(input: {
  service?: AgendaService;
  db: SqliteDatabase;
  organizationId: number;
  userId: number;
  body: AgendaPostBody;
}) {
  const body = input.body;
  if (!Number.isInteger(body.opportunityId) || !body.type || !REMINDER_TYPES.includes(body.type)
    || !body.title?.trim() || !body.dueAt || Number.isNaN(Date.parse(body.dueAt))) {
    throw createError({ statusCode: 400, statusMessage: 'Lembrete inválido' });
  }
  const reminder = (input.service ?? new AgendaService(input.db)).createManual({
    organizationId: input.organizationId,
    opportunityId: body.opportunityId as number,
    userId: input.userId,
    type: body.type,
    title: body.title,
    dueAt: body.dueAt,
    note: body.note,
  });
  if (!reminder) throw createError({ statusCode: 404, message: 'Licitação não encontrada' });
  return reminder;
}

export default defineEventHandler(async (event) => {
  const context = requireActiveBilling(event, 'kanban');
  return handleAgendaPost({
    db: getAppDatabase(),
    organizationId: context.organization.id,
    userId: context.user.id,
    body: await readBody<AgendaPostBody>(event),
  });
});
