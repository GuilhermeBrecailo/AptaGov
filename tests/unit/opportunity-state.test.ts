import { describe, expect, it } from 'vitest';
import { createTestDatabase } from '../../src/db/database';
import { OpportunityRepository } from '../../src/repositories/opportunityRepository';
import { transitionOpportunity } from '../../src/services/opportunityService';

describe('opportunity state', () => {
  it('registra a transição válida e rejeita salto inválido', () => {
    const db = createTestDatabase();
    const repository = new OpportunityRepository(db);
    const opportunityId = repository.insert({
      pncpId: 'state-1',
      title: 'Oportunidade',
      description: '',
      state: 'SP',
      organization: 'Órgão',
      sourceUrl: 'https://pncp.gov.br',
      publicationDate: '2026-08-31T10:00:00.000Z',
      estimatedValueCents: 0,
    });

    transitionOpportunity(repository, opportunityId, 'QUALIFIED');
    expect(repository.findById(opportunityId)?.kanbanState).toBe('QUALIFIED');
    expect(() => transitionOpportunity(repository, opportunityId, 'WON')).toThrow();
  });
});
