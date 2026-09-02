import { createError, defineEventHandler, getRouterParam, readBody } from 'h3';
import type { ChecklistCategory, ChecklistPatch, ChecklistStatus } from '../../../../../src/domain/operationalTypes';
import { ChecklistRepository } from '../../../../../src/repositories/checklistRepository';
import { ChecklistService } from '../../../../../src/services/checklistService';
import { OrganizationRepository } from '../../../../../src/repositories/organizationRepository';
import { OpportunityRepository } from '../../../../../src/repositories/opportunityRepository';
import type { SqliteDatabase } from '../../../../../src/db/database';
import { getAppDatabase, getRuntime, requireActiveBilling } from '../../../../utils/app';

const CHECKLIST_STATUSES: readonly ChecklistStatus[] = ['OPEN', 'COMPLETED', 'SKIPPED'];
const CHECKLIST_CATEGORIES: readonly ChecklistCategory[] = ['DOCUMENTS', 'COMMERCIAL', 'PROPOSAL', 'SESSION', 'REVIEW'];

export async function handleOpportunityChecklistPatch(input: {
  service?: ChecklistService;
  opportunities?: OpportunityRepository;
  organizations?: OrganizationRepository;
  db: SqliteDatabase;
  organizationId: number;
  opportunityId: number;
  itemId: number;
  body: ChecklistPatch;
}) {
  const opportunityId = input.opportunityId;
  const itemId = input.itemId;
  const body = input.body ?? {};

  if (!Number.isInteger(opportunityId) || !Number.isInteger(itemId)) {
    throw createError({ statusCode: 400, message: 'Item de preparação inválido' });
  }
  if (body.title !== undefined && !body.title.trim()) {
    throw createError({ statusCode: 400, message: 'Título inválido' });
  }
  if (body.status !== undefined && !CHECKLIST_STATUSES.includes(body.status)) {
    throw createError({ statusCode: 400, message: 'Status inválido' });
  }
  if (body.category !== undefined && !CHECKLIST_CATEGORIES.includes(body.category)) {
    throw createError({ statusCode: 400, message: 'Categoria inválida' });
  }
  if (body.dueAt !== undefined && body.dueAt !== null && Number.isNaN(Date.parse(body.dueAt))) {
    throw createError({ statusCode: 400, message: 'Prazo inválido' });
  }
  if (body.assigneeUserId !== undefined && body.assigneeUserId !== null && !Number.isInteger(body.assigneeUserId)) {
    throw createError({ statusCode: 400, message: 'Responsável inválido' });
  }

  const opportunities = input.opportunities ?? new OpportunityRepository(input.db);
  if (!opportunities.findById(opportunityId) || !opportunities.findOrganizationState(input.organizationId, opportunityId)) {
    throw createError({ statusCode: 404, message: 'Checklist não encontrado' });
  }
  if (body.assigneeUserId !== undefined && body.assigneeUserId !== null
    && !(input.organizations ?? new OrganizationRepository(input.db)).findMembership(body.assigneeUserId, input.organizationId)) {
    throw createError({ statusCode: 400, message: 'Responsável não pertence à organização' });
  }

  const checklist = input.service ?? new ChecklistService(new ChecklistRepository(input.db));
  const updated = checklist.update(input.organizationId, itemId, body);
  if (!updated || updated.opportunityId !== opportunityId) {
    throw createError({ statusCode: 404, message: 'Item de preparação não encontrado' });
  }
  return updated;
}

export default defineEventHandler(async (event) => {
  const context = requireActiveBilling(event, 'kanban');
  const runtime = getRuntime();
  return handleOpportunityChecklistPatch({
    db: getAppDatabase(),
    opportunities: runtime.opportunities,
    organizationId: context.organization.id,
    opportunityId: Number(getRouterParam(event, 'id')),
    itemId: Number(getRouterParam(event, 'itemId')),
    body: (await readBody<ChecklistPatch>(event)) ?? {},
  });
});
