import { createError, defineEventHandler, readBody } from 'h3';
import { z } from 'zod';
import type { SqliteDatabase } from '../../src/db/database';
import { OrganizationAlertPreferenceRepository } from '../../src/repositories/organizationAlertPreferenceRepository';
import { getAppDatabase, requireActiveBilling } from '../utils/app';

const alertPreferenceSchema = z.object({
  proposalDeadline: z.boolean(),
  sessionOpening: z.boolean(),
  disputeStart: z.boolean(),
}).strict();

export async function handleAlertPreferencesPut(input: {
  db: SqliteDatabase;
  organizationId: number;
  body: unknown;
}) {
  const parsed = alertPreferenceSchema.safeParse(input.body);
  if (!parsed.success) throw createError({ statusCode: 400, message: 'Preferências de alertas inválidas' });
  return new OrganizationAlertPreferenceRepository(input.db).save(input.organizationId, parsed.data);
}

export default defineEventHandler(async (event) => {
  const context = requireActiveBilling(event, 'kanban');
  return handleAlertPreferencesPut({
    db: getAppDatabase(),
    organizationId: context.organization.id,
    body: await readBody(event),
  });
});
