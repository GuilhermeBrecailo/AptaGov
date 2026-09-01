import { VALID_TRANSITIONS, type KanbanState } from '../domain/types';
import type { OpportunityRepository } from '../repositories/opportunityRepository';

export function transitionOpportunity(repository: OpportunityRepository, opportunityId: number, nextState: KanbanState): void {
  const opportunity = repository.findById(opportunityId);
  if (!opportunity) {
    throw new Error(`Opportunity ${opportunityId} not found`);
  }
  if (!VALID_TRANSITIONS[opportunity.kanbanState].includes(nextState)) {
    throw new Error(`Invalid opportunity transition: ${opportunity.kanbanState} -> ${nextState}`);
  }
  repository.updateState(opportunityId, nextState);
  repository.addEvent(opportunityId, opportunity.kanbanState, nextState);
}

export function transitionOrganizationOpportunity(
  repository: OpportunityRepository,
  organizationId: number,
  opportunityId: number,
  nextState: KanbanState,
): void {
  const opportunity = repository.findById(opportunityId);
  if (!opportunity) {
    throw new Error(`Opportunity ${opportunityId} not found`);
  }
  const currentState = repository.findOrganizationState(organizationId, opportunityId);
  if (!currentState) {
    throw new Error(`Opportunity ${opportunityId} is not in organization ${organizationId} kanban`);
  }
  if (!VALID_TRANSITIONS[currentState].includes(nextState)) {
    throw new Error(`Invalid opportunity transition: ${currentState} -> ${nextState}`);
  }
  repository.updateOrganizationState(organizationId, opportunityId, nextState);
  repository.addEvent(opportunityId, currentState, nextState);
}
