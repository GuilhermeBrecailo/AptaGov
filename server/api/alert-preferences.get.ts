import { defineEventHandler } from 'h3';
import type { SqliteDatabase } from '../../src/db/database';
import { OrganizationAlertPreferenceRepository } from '../../src/repositories/organizationAlertPreferenceRepository';
import { getAppDatabase, requireActiveBilling } from '../utils/app';

export function handleAlertPreferencesGet(input: {
  db: SqliteDatabase;
  organizationId: number;
}) {
  return new OrganizationAlertPreferenceRepository(input.db).find(input.organizationId);
}

export default defineEventHandler((event) => {
  const context = requireActiveBilling(event, 'kanban');
  return handleAlertPreferencesGet({
    db: getAppDatabase(),
    organizationId: context.organization.id,
  });
});
