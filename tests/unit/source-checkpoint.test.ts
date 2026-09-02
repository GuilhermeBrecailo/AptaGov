import { describe, expect, it } from 'vitest';
import { createTestDatabase } from '../../src/db/database';
import type { MarketObservationInput, MarketResultInput, SourceQuery, SourceWindow } from '../../src/domain/sourceTypes';
import type { OpportunityInput } from '../../src/domain/types';
import { PncpSourceClient, syncSourceOpportunities } from '../../src/integrations/sources/OfficialSourceClient';
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

function marketResult(price: number, raw: unknown = { price }): MarketResultInput {
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
    winner: 'Fornecedor BEC',
    awardedPriceCents: price * 2,
    status: 'AWARDED',
    raw,
  };
}

const sourceQuery: SourceQuery = {
  ...window,
  filters: {
    lookbackDays: 3,
    states: ['SP'],
    citiesIbge: [],
    modalities: ['6'],
    keywords: [],
    excludedKeywords: [],
    minimumScore: 0,
    estimatedValueMinCents: 0,
    scoreWeights: { keyword: 50, region: 20, value: 10, deadline: 20 },
  },
};

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

  it('cria market_results com contrato completo, índices e constraints de origem', () => {
    const db = createTestDatabase();
    const columns = (db.prepare("PRAGMA table_info('market_results')").all() as Array<{ name: string }>).map((row) => row.name);
    expect(columns).toEqual(expect.arrayContaining([
      'source_code', 'external_id', 'item_code', 'normalized_description', 'unit', 'quantity',
      'unit_price_cents', 'total_price_cents', 'organization', 'state', 'observed_at',
      'opportunity_id', 'winner', 'awarded_price_cents', 'status', 'source_url', 'raw_json',
    ]));
    const indexes = db.prepare("PRAGMA index_list('market_results')").all() as Array<{ name: string; unique: number }>;
    expect(indexes.some((index) => index.unique === 1)).toBe(true);
    expect(indexes.map((index) => index.name)).toEqual(expect.arrayContaining([
      'idx_market_results_source_date',
      'idx_market_results_item_date',
      'idx_market_results_description_date',
      'idx_market_results_organization_state',
    ]));

    const observationIndexes = db.prepare("PRAGMA index_list('market_observations')").all() as Array<{ name: string; unique: number }>;
    expect(observationIndexes.map((index) => index.name)).toEqual(expect.arrayContaining([
      'idx_market_observations_item_date',
      'idx_market_observations_description_date',
      'idx_market_observations_source_date',
      'idx_market_observations_organization_state',
    ]));

    const checkpointColumns = (db.prepare("PRAGMA table_info('source_checkpoints')").all() as Array<{ name: string }>).map((row) => row.name);
    expect(checkpointColumns).toEqual(expect.arrayContaining([
      'source_code', 'window_start', 'window_end', 'cursor', 'status', 'error_category', 'last_success_at', 'next_retry_at',
    ]));
    const checkpointIndexes = db.prepare("PRAGMA index_list('source_checkpoints')").all() as Array<{ unique: number }>;
    expect(checkpointIndexes.some((index) => index.unique === 1)).toBe(true);

    const runIndexes = db.prepare("PRAGMA index_list('source_runs')").all() as Array<{ name: string }>;
    expect(runIndexes.map((index) => index.name)).toEqual(expect.arrayContaining([
      'idx_source_runs_source_started',
      'idx_source_runs_status',
    ]));
    const checkpointSql = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'source_checkpoints'").get() as { sql: string };
    expect(checkpointSql.sql).toContain("CHECK (status IN ('RUNNING', 'COMPLETED', 'FAILED'))");
  });

  it('persiste market_results de modo transacional, idempotente e com raw redacted', () => {
    const db = createTestDatabase();
    const repository = new SourceSyncRepository(db);
    const sensitive = { accessToken: 'token-value', nested: { authorization: 'secret-value' }, visible: 'ok' };

    expect(repository.persistMarketResultsPage({ sourceCode: 'BEC/SP', window, items: [marketResult(1_000, sensitive)] }))
      .toMatchObject({ created: 1, updated: 0 });
    expect(repository.persistMarketResultsPage({ sourceCode: 'BEC/SP', window, items: [marketResult(1_200, sensitive)] }))
      .toMatchObject({ created: 0, updated: 1 });

    const results = repository.listMarketResults('BEC/SP');
    expect(results).toHaveLength(1);
    expect(results[0]!).toMatchObject({ unitPriceCents: 1_200, awardedPriceCents: 2_400 });
    expect(results[0]!.raw).toEqual({ accessToken: '[redacted]', nested: { authorization: '[redacted]' }, visible: 'ok' });

    expect(() => repository.persistMarketResultsPage({
      sourceCode: 'BEC/SP',
      window,
      items: [
        { ...marketResult(900), externalId: 'second-result' },
        { ...marketResult(800), externalId: 'rolled-back-result', normalizedDescription: undefined as unknown as string },
      ],
    })).toThrow();
    expect(repository.listMarketResults('BEC/SP').map((item) => item.externalId)).toEqual(['100111000012026OC00015']);
  });

  it('rejeita lote de fonte divergente antes de abrir a transação', () => {
    const db = createTestDatabase();
    const opportunities = new OpportunityRepository(db);
    const repository = new SourceSyncRepository(db, opportunities);

    expect(() => repository.persistOpportunityPage({
      sourceCode: 'BEC/SP',
      window,
      cursor: null,
      nextCursor: 'page:2',
      items: [{ ...opportunity('mixed'), source: 'PNCP', sourceCode: 'PNCP' }],
    })).toThrow(/sourceCode/);
    expect(opportunities.count()).toBe(0);
    expect(repository.getCheckpoint('BEC/SP', window)).toBeUndefined();
    expect(() => repository.persistMarketResultsPage({
      sourceCode: 'BEC/SP',
      window,
      items: [{ ...marketResult(1_000), source: 'PNCP', sourceCode: 'PNCP' }],
    })).toThrow(/sourceCode/);
    expect(repository.listMarketResults('BEC/SP')).toHaveLength(0);
  });

  it('preserva cursor ao registrar falha e grava source_runs', () => {
    const db = createTestDatabase();
    const repository = new SourceSyncRepository(db);
    repository.persistOpportunityPage({ sourceCode: 'BEC/SP', window, cursor: null, nextCursor: 'page:2', items: [opportunity('run-1')] });

    const checkpoint = repository.recordFailure('BEC/SP', window, 'UNAVAILABLE', '2026-09-02T12:00:00.000Z');
    expect(checkpoint).toMatchObject({ cursor: 'page:2', status: 'FAILED', errorCategory: 'UNAVAILABLE' });

    const runId = repository.beginRun('BEC/SP', window, checkpoint.cursor);
    repository.failRun(runId, 'UNAVAILABLE', 'BEC/SP indisponível');
    expect(db.prepare('SELECT source_code, cursor, status, error_category, error_message FROM source_runs WHERE id = ?').get(runId)).toMatchObject({
      source_code: 'BEC/SP', cursor: 'page:2', status: 'FAILED', error_category: 'UNAVAILABLE',
    });
  });

  it('integra adapter, persistência e checkpoint, retomando após falha na página 3', async () => {
    const db = createTestDatabase();
    const opportunities = new OpportunityRepository(db);
    const repository = new SourceSyncRepository(db, opportunities);
    const requestedPages: number[] = [];
    let failPageThree = true;
    const adapter = new PncpSourceClient({
      sourceClient: {
        fetchPublishedPage: async (_query, page) => {
          requestedPages.push(page);
          if (page === 3 && failPageThree) return { data: [{ objetoCompra: 'sem identificador' }], totalPaginas: 3, numeroPagina: page };
          return {
            data: [{
              numeroControlePNCP: `pncp-${page}`,
              objetoCompra: `Contratação ${page}`,
              dataPublicacaoPncp: '2026-08-31T10:00:00.000Z',
              orgaoEntidade: { razaoSocial: 'Órgão oficial' },
              unidadeOrgao: { ufSigla: 'SP', municipioNome: 'São Paulo' },
            }],
            totalPaginas: 3,
            numeroPagina: page,
          };
        },
      },
    });

    await expect(syncSourceOpportunities(adapter, sourceQuery, repository)).rejects.toThrow('stable identifier');
    expect(requestedPages).toEqual([1, 2, 3]);
    expect(opportunities.count()).toBe(2);
    expect(repository.getCheckpoint('PNCP', window)).toMatchObject({ cursor: 'page:3', status: 'FAILED' });

    requestedPages.length = 0;
    failPageThree = false;
    await syncSourceOpportunities(adapter, sourceQuery, repository);
    expect(requestedPages).toEqual([3]);
    expect(opportunities.count()).toBe(3);
    expect(repository.getCheckpoint('PNCP', window)).toMatchObject({ cursor: null, status: 'COMPLETED' });
  });
});
