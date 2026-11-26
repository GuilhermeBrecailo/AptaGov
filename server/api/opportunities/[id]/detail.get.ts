import { createError, defineEventHandler, getRouterParam } from 'h3';
import type { SqliteDatabase } from '../../../../src/db/database';
import { businessDaysBefore, LEGAL_DEADLINE_NOTE } from '../../../../src/domain/legalDeadlines';
import { OpportunityRepository, type CatalogOpportunity } from '../../../../src/repositories/opportunityRepository';
import { OpportunityReminderRepository } from '../../../../src/repositories/opportunityReminderRepository';
import { proposalStartFromRaw, sessionOpeningFromRaw } from '../../../../src/services/opportunityChangeService';
import type { OpportunityDetailPncp, OpportunityDetailService } from '../../../../src/services/opportunityDetail/opportunityDetailService';
import { getAppDatabase, getOpportunityDetailService, requireActiveBilling } from '../../../utils/app';

export type OpportunityDeadline = {
  key: 'publication' | 'proposalStart' | 'proposal' | 'opening' | 'challenge' | 'clarification';
  label: string;
  at: string | null;
  note: string | null;
};

export async function handleOpportunityDetailGet(input: {
  db: SqliteDatabase;
  organizationId: number;
  opportunityId: number;
  service: Pick<OpportunityDetailService, 'get'>;
}): Promise<{ opportunity: Omit<CatalogOpportunity, 'raw'>; pncp: OpportunityDetailPncp; deadlines: OpportunityDeadline[] }> {
  const opportunity = Number.isInteger(input.opportunityId) && input.opportunityId > 0
    ? new OpportunityRepository(input.db).listCatalog({
      organizationId: input.organizationId,
      opportunityId: input.opportunityId,
      situationFilter: 'all',
      hideNotRelevant: false,
      pageSize: 1,
    }).data[0]
    : undefined;
  if (!opportunity) throw createError({ statusCode: 404, statusMessage: 'Licitação não encontrada' });

  const pncp = await input.service.get(opportunity.id);
  const opening = sessionOpeningFromRaw(opportunity.raw);
  // Mesma base da Agenda: abertura explícita ou, sem ela, o fim das propostas.
  const legalBase = opening ?? opportunity.biddingDeadline ?? null;
  const reminders = new OpportunityReminderRepository(input.db).listForOpportunity(input.organizationId, opportunity.id);
  const legal = (type: 'CHALLENGE_DEADLINE' | 'CLARIFICATION_DEADLINE'): Pick<OpportunityDeadline, 'at' | 'note'> => {
    const reminder = reminders.find((item) => item.type === type && item.createdByUserId === null);
    if (reminder) return { at: reminder.dueAt, note: reminder.note };
    const estimated = legalBase ? businessDaysBefore(legalBase, 3) : null;
    return estimated ? { at: estimated, note: LEGAL_DEADLINE_NOTE } : { at: null, note: null };
  };

  const deadlines: OpportunityDeadline[] = [
    { key: 'publication', label: 'Publicação', at: opportunity.publicationDate || null, note: null },
    { key: 'proposalStart', label: 'Início das propostas', at: proposalStartFromRaw(opportunity.raw), note: null },
    { key: 'proposal', label: 'Propostas até', at: opportunity.biddingDeadline ?? null, note: null },
    { key: 'opening', label: 'Abertura da sessão', at: opening, note: null },
    { key: 'challenge', label: 'Impugnação até', ...legal('CHALLENGE_DEADLINE') },
    { key: 'clarification', label: 'Esclarecimentos até', ...legal('CLARIFICATION_DEADLINE') },
  ];
  const publicOpportunity: Omit<CatalogOpportunity, 'raw'> & { raw?: unknown } = { ...opportunity };
  delete publicOpportunity.raw;
  return { opportunity: publicOpportunity, pncp, deadlines };
}

export default defineEventHandler((event) => {
  const context = requireActiveBilling(event, 'catalog');
  return handleOpportunityDetailGet({
    db: getAppDatabase(),
    organizationId: context.organization.id,
    opportunityId: Number(getRouterParam(event, 'id')),
    service: getOpportunityDetailService(),
  });
});
