import { describe, expect, it } from 'vitest';
import { createTestDatabase } from '../../src/db/database';
import type { MarketObservationInput, SourceWindow } from '../../src/domain/sourceTypes';
import type { OpportunityInput } from '../../src/domain/types';
import { OpportunityRepository } from '../../src/repositories/opportunityRepository';
import { SourceSyncRepository } from '../../src/repositories/sourceSyncRepository';

const window: SourceWindow = {
  dateFrom: '2026-08-28',
  dateTo: '2026-08-31',
};

function opportunity(id: string): OpportunityInput {
  return {
    pncpId: id,
    sourceCode: 'BEC/SP',
    source: 'BEC/SP',
    title: `Oportunidade ${id}`,
    description: 'Descrição oficial',
    organization: 'Órgão oficial',
    state: 'SP',
    city: 'São Paulo',
    modality: 'Pregão Eletrônico',
    sourceUrl: `https://www.bec.sp.gov.br/edital/${id}`,
    publicationDate: '2026-08-31T10:00:00.000Z',
    biddingDeadline: null,
    estimatedValueCents: 0,
    raw: { id },
  };
}

function marketObservation(price: number): MarketObservationInput {
  return {
    sourceCode: 'BEC/SP',
    externalId: '100111000012026OC00015',
    itemCode: '12345',
    normalizedDescription: 'servico de suporte',
    unit: 'UNIDADE',
    quantity: 2,
    unitPriceCents: price,
    totalPriceCents: price * 2,
    organization: 'Órgão BEC',
    state: 'SP',
    observedAt: '2026-08-31T10:00:00.000Z',
    sourceUrl: 'https://www.bec.sp.gov.br/edital/oc-15',
    raw: { price },
  };
}

describe('checkpoints de fontes oficiais', () => {
  it('retoma pelo cursor persistido e só conclui após persistir a página inteira', () => {
    const db = createTestDatabase();
    const opportunities = new OpportunityRepository(db);
    const repository = new SourceSyncRepository(db, opportunities);

    repository.persistOpportunityPage({
      sourceCode: 'BEC/SP',
      window,
      cursor: null,
      nextCursor: 'page:2',
      items: [opportunity('bec-1')],
    });

    expect(repository.getCheckpoint('BEC/SP', window)).toMatchObject({
      cursor: 'page:2',
      status: 'RUNNING',
    });
    expect(repository.getResumeCursor('BEC/SP', window)).toBe('page:2');

    repository.persistOpportunityPage({
      sourceCode: 'BEC/SP',
      window,
      cursor: 'page:2',
      nextCursor: null,
      items: [opportunity('bec-2')],
    });

    expect(repository.getCheckpoint('BEC/SP', window)).toMatchObject({
      cursor: null,
      status: 'COMPLETED',
    });
    expect(opportunities.count()).toBe(2);
  });

  it('não avança nem mantém registros parciais quando a página falha', () => {
    const db = createTestDatabase();
    const opportunities = new OpportunityRepository(db);
    const repository = new SourceSyncRepository(db, opportunities);
    repository.persistOpportunityPage({
      sourceCode: 'BEC/SP',
      window,
      cursor: null,
      nextCursor: 'page:2',
      items: [opportunity('bec-1')],
    });

    expect(() => repository.persistOpportunityPage({
      sourceCode: 'BEC/SP',
      window,
      cursor: 'page:2',
      nextCursor: null,
      items: [opportunity('bec-2'), { ...opportunity('invalid'), title: undefined } as unknown as OpportunityInput],
    })).toThrow();

    expect(repository.getCheckpoint('BEC/SP', window)).toMatchObject({
      cursor: 'page:2',
      status: 'RUNNING',
    });
    expect(opportunities.findByPncpId('bec-2')).toBeUndefined();
    expect(opportunities.count()).toBe(1);
  });

  it('deduplica observação pelo trio fonte, identificador externo e item e atualiza o payload', () => {
    const db = createTestDatabase();
    const repository = new SourceSyncRepository(db);

    repository.persistMarketPage({ sourceCode: 'BEC/SP', window, items: [marketObservation(1_000)] });
    repository.persistMarketPage({ sourceCode: 'BEC/SP', window, items: [marketObservation(1_200)] });

    const observations = repository.listMarketObservations('BEC/SP');
    expect(observations).toHaveLength(1);
    expect(observations[0]).toMatchObject({
      externalId: '100111000012026OC00015',
      itemCode: '12345',
      unitPriceCents: 1_200,
      totalPriceCents: 2_400,
    });
  });
});
