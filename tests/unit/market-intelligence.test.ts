import { describe, expect, it } from 'vitest';
import { createTestDatabase } from '../../src/db/database';
import { loadEnv } from '../../src/config/env';
import type { MarketObservationInput, MarketResultInput } from '../../src/domain/sourceTypes';
import type { OpportunityInput } from '../../src/domain/types';
import { MarketRepository } from '../../src/repositories/marketRepository';
import { OrganizationRepository } from '../../src/repositories/organizationRepository';
import { OpportunityRepository } from '../../src/repositories/opportunityRepository';
import { SourceSyncRepository } from '../../src/repositories/sourceSyncRepository';
import { MarketIntelligenceService } from '../../src/services/marketIntelligenceService';
import { handleOpportunityMarketGet } from '../../server/api/opportunities/[id]/market.get';

const period = {
  dateFrom: '2026-01-01T00:00:00.000Z',
  dateTo: '2026-04-30T23:59:59.999Z',
};

function observation(overrides: Partial<MarketObservationInput> = {}): MarketObservationInput {
  return {
    sourceCode: 'PNCP',
    externalId: `purchase-${Math.random()}`,
    itemCode: 'ITEM-1',
    normalizedDescription: 'servico de suporte',
    unit: 'UN',
    quantity: 1,
    unitPriceCents: 1_000,
    totalPriceCents: 1_000,
    organization: 'Prefeitura Exemplo',
    state: 'SP',
    observedAt: '2026-01-15T10:00:00.000Z',
    sourceUrl: 'https://pncp.gov.br/compra/1',
    ...overrides,
  };
}

function result(overrides: Partial<MarketResultInput> = {}): MarketResultInput {
  return {
    sourceCode: 'PNCP',
    externalId: `result-${Math.random()}`,
    itemCode: 'ITEM-1',
    normalizedDescription: 'servico de suporte',
    unit: 'UN',
    quantity: 1,
    unitPriceCents: 2_000,
    totalPriceCents: 2_000,
    organization: 'Prefeitura Exemplo',
    state: 'SP',
    winner: 'Fornecedor Exemplo',
    awardedPriceCents: 2_000,
    status: 'HOMOLOGADO',
    observedAt: '2026-02-15T10:00:00.000Z',
    sourceUrl: 'https://pncp.gov.br/resultado/1',
    ...overrides,
  };
}

function serviceWithSeed(items: MarketObservationInput[] = [], results: MarketResultInput[] = [], minimumObservations = 1) {
  const db = createTestDatabase();
  const sync = new SourceSyncRepository(db);
  sync.persistMarketPage({ sourceCode: 'PNCP', window: period, items });
  sync.persistMarketResultsPage({ sourceCode: 'PNCP', window: period, items: results });
  return {
    db,
    service: new MarketIntelligenceService(new MarketRepository(db), { minimumObservations }),
  };
}

describe('inteligência de mercado', () => {
  it('carrega defaults seguros do contrato de mercado', () => {
    expect(loadEnv({ NODE_ENV: 'test', DATABASE_URL: ':memory:' })).toMatchObject({
      marketMinObservations: 5,
      marketLookbackDays: 365,
      becSpEnabled: false,
    });
  });

  it('calcula mínimo, mediana e máximo em centavos sem usar o valor total', () => {
    const { service } = serviceWithSeed([
      observation({ externalId: 'p1', unitPriceCents: 1_000, totalPriceCents: 99_000 }),
      observation({ externalId: 'p2', unitPriceCents: 2_000, totalPriceCents: 198_000 }),
      observation({ externalId: 'p3', unitPriceCents: 4_000, totalPriceCents: 396_000 }),
      observation({ externalId: 'p4', unitPriceCents: 8_000, totalPriceCents: 792_000 }),
    ]);

    const summary = service.getMarketSummary({ ...period, itemCode: 'ITEM-1', normalizedDescription: 'servico de suporte', unit: 'UN' });

    expect(summary).toMatchObject({
      state: 'READY',
      observationCount: 4,
      minPriceCents: 1_000,
      medianPriceCents: 3_000,
      maxPriceCents: 8_000,
      count: 4,
      min: 1_000,
      median: 3_000,
      max: 8_000,
    });
  });

  it('produz série mensal com contagem e mediana por mês', () => {
    const { service } = serviceWithSeed([
      observation({ externalId: 'jan-1', unitPriceCents: 1_000, observedAt: '2026-01-05T10:00:00.000Z' }),
      observation({ externalId: 'jan-2', unitPriceCents: 3_000, observedAt: '2026-01-20T10:00:00.000Z' }),
      observation({ externalId: 'mar-1', unitPriceCents: 9_000, observedAt: '2026-03-08T10:00:00.000Z' }),
    ]);

    const summary = service.getMarketSummary({ ...period, itemCode: 'ITEM-1', normalizedDescription: 'servico de suporte', unit: 'UN' });

    expect(summary.monthlySeries).toEqual([
      { month: '2026-01', count: 2, medianPriceCents: 2_000 },
      { month: '2026-02', count: 0, medianPriceCents: null },
      { month: '2026-03', count: 1, medianPriceCents: 9_000 },
      { month: '2026-04', count: 0, medianPriceCents: null },
    ]);
  });

  it('não agrega códigos ou unidades incompatíveis', () => {
    const { service } = serviceWithSeed([
      observation({ externalId: 'compatible', unitPriceCents: 1_000 }),
      observation({ externalId: 'other-code', itemCode: 'ITEM-2', unitPriceCents: 50_000 }),
      observation({ externalId: 'other-unit', unit: 'HORA', unitPriceCents: 90_000 }),
    ]);

    const summary = service.getMarketSummary({ ...period, normalizedDescription: 'servico de suporte', itemCode: 'ITEM-1', unit: 'UN' });

    expect(summary.observationCount).toBe(1);
    expect(summary.medianPriceCents).toBe(1_000);
  });

  it('mantém o preço unitário válido ao deduplicar observação e resultado da mesma compra', () => {
    const { service } = serviceWithSeed(
      [observation({ externalId: 'same-purchase', unitPriceCents: 2_500 })],
      [result({ externalId: 'same-purchase', unitPriceCents: null, totalPriceCents: 2_500 })],
    );

    const summary = service.getMarketSummary({ ...period, itemCode: 'ITEM-1', normalizedDescription: 'servico de suporte', unit: 'UN' });

    expect(summary).toMatchObject({ state: 'READY', observationCount: 1, medianPriceCents: 2_500, purchaseCount: 1 });
  });

  it('retorna INSUFFICIENT_DATA sem estimativas quando a amostra é menor que o mínimo', () => {
    const { service } = serviceWithSeed([observation()], [], 3);

    const summary = service.getMarketSummary({ ...period, itemCode: 'ITEM-1', normalizedDescription: 'servico de suporte', unit: 'UN' });

    expect(summary).toMatchObject({
      state: 'INSUFFICIENT_DATA',
      observationCount: 1,
      minPriceCents: null,
      medianPriceCents: null,
      maxPriceCents: null,
      purchaseCount: 1,
    });
    expect(summary).not.toHaveProperty('probability');
    expect(summary.message).toContain('Dados insuficientes');
  });

  it('preserva compra, modalidade, situação, atualização e links de auditoria', () => {
    const db = createTestDatabase();
    const opportunities = new OpportunityRepository(db);
    const opportunityId = opportunities.insert({
      pncpId: 'opportunity-market-1',
      title: 'Suporte oficial',
      description: 'Serviço de suporte',
      organization: 'Prefeitura Exemplo',
      state: 'SP',
      modality: 'Pregão eletrônico',
      sourceUrl: 'https://pncp.gov.br/oportunidade/1',
      publicationDate: '2026-02-01T00:00:00.000Z',
      estimatedValueCents: 0,
    });
    const sync = new SourceSyncRepository(db);
    sync.persistMarketResultsPage({
      sourceCode: 'PNCP',
      window: period,
      items: [result({ externalId: 'r1', opportunityId, sourceUrl: 'https://pncp.gov.br/resultado/r1' })],
    });
    const service = new MarketIntelligenceService(new MarketRepository(db), { minimumObservations: 1 });

    const summary = service.getMarketSummary({ ...period, itemCode: 'ITEM-1', normalizedDescription: 'servico de suporte', unit: 'UN' });

    expect(summary.purchaseCount).toBe(1);
    expect(summary.modalityBreakdown).toEqual([{ label: 'Pregão eletrônico', count: 1 }]);
    expect(summary.statusBreakdown).toEqual([{ label: 'HOMOLOGADO', count: 1 }]);
    expect(summary.lastUpdatedAt).toBe('2026-02-15T10:00:00.000Z');
    expect(summary.sourceLinks).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceCode: 'PNCP', url: 'https://pncp.gov.br/resultado/r1' }),
    ]));
    expect(summary.auditLinks).toEqual(expect.arrayContaining([
      expect.objectContaining({ externalId: 'r1', url: 'https://pncp.gov.br/resultado/r1' }),
    ]));
  });

  it('aplica período, estado, órgão, descrição e código com filtros parametrizados', () => {
    const { service } = serviceWithSeed([
      observation({ externalId: 'target', unitPriceCents: 1_500, organization: 'Órgão alvo', state: 'RJ', observedAt: '2026-03-01T10:00:00.000Z', normalizedDescription: 'item alvo', itemCode: 'ALVO' }),
      observation({ externalId: 'other', unitPriceCents: 99_000, organization: 'Órgão alvo', state: 'RJ', observedAt: '2026-05-01T10:00:00.000Z', normalizedDescription: 'item alvo', itemCode: 'ALVO' }),
      observation({ externalId: 'injection', unitPriceCents: 99_000, organization: "' OR 1=1 --", state: 'SP', normalizedDescription: 'outro item', itemCode: 'OUTRO' }),
    ]);

    const summary = service.getMarketSummary({
      dateFrom: '2026-03-01T00:00:00.000Z',
      dateTo: '2026-03-31T23:59:59.999Z',
      state: 'RJ',
      organization: 'Órgão alvo',
      normalizedDescription: 'item alvo',
      itemCode: 'ALVO',
      unit: 'UN',
    });

    expect(summary).toMatchObject({ state: 'READY', observationCount: 1, medianPriceCents: 1_500 });
  });

  it('expõe comparação da oportunidade somente para organização autorizada e identidade compatível', () => {
    const db = createTestDatabase();
    const opportunities = new OpportunityRepository(db);
    const opportunityInput: OpportunityInput = {
      pncpId: 'detail-market-1',
      title: 'Suporte técnico',
      description: 'Contratação de suporte',
      organization: 'Prefeitura Exemplo',
      state: 'SP',
      sourceUrl: 'https://pncp.gov.br/detail-market-1',
      publicationDate: '2026-02-01T00:00:00.000Z',
      estimatedValueCents: 0,
      raw: { codigoItem: 'ITEM-1', descricaoItem: 'Serviço de suporte', unidadeFornecimento: 'UN' },
    };
    const opportunityId = opportunities.insert(opportunityInput);
    const organizations = [
      new OrganizationRepository(db).create('Empresa autorizada').id,
      new OrganizationRepository(db).create('Empresa não autorizada').id,
    ];
    opportunities.addToKanban(organizations[0]!, opportunityId);
    new SourceSyncRepository(db).persistMarketPage({
      sourceCode: 'PNCP',
      window: period,
      items: [observation({ externalId: 'detail-price', unitPriceCents: 2_500 })],
    });
    const service = new MarketIntelligenceService(new MarketRepository(db), { minimumObservations: 1 });

    const authorized = handleOpportunityMarketGet({ opportunities, service, organizationId: organizations[0]!, opportunityId });
    expect(authorized.state).toBe('READY');
    expect(authorized.comparison?.medianPriceCents).toBe(2_500);
    expect(() => handleOpportunityMarketGet({ opportunities, service, organizationId: organizations[1]!, opportunityId })).toThrow(/não encontrada/i);
  });

  it('retorna texto de dados insuficientes quando unidade da oportunidade não combina', () => {
    const db = createTestDatabase();
    const opportunities = new OpportunityRepository(db);
    const opportunityId = opportunities.insert({
      pncpId: 'detail-market-incompatible',
      title: 'Suporte técnico',
      description: 'Contratação de suporte',
      organization: 'Prefeitura Exemplo',
      state: 'SP',
      sourceUrl: 'https://pncp.gov.br/detail-market-incompatible',
      publicationDate: '2026-02-01T00:00:00.000Z',
      estimatedValueCents: 0,
      raw: { codigoItem: 'ITEM-1', descricaoItem: 'Serviço de suporte', unidadeFornecimento: 'UN' },
    });
    const organizationId = new OrganizationRepository(db).create('Empresa detalhe incompatível').id;
    opportunities.addToKanban(organizationId, opportunityId);
    new SourceSyncRepository(db).persistMarketPage({
      sourceCode: 'PNCP',
      window: period,
      items: [observation({ unit: 'HORA' })],
    });

    const response = handleOpportunityMarketGet({
      opportunities,
      service: new MarketIntelligenceService(new MarketRepository(db), { minimumObservations: 1 }),
      organizationId,
      opportunityId,
    });

    expect(response).toMatchObject({ state: 'INSUFFICIENT_DATA', comparison: null, message: 'Dados insuficientes para comparação' });
  });
});
