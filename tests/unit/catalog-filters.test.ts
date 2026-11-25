import { describe, expect, it } from 'vitest';
import { createTestDatabase } from '../../src/db/database';
import type { OpportunityInput } from '../../src/domain/types';
import { OpportunityRepository } from '../../src/repositories/opportunityRepository';
import { listOpportunityFacets } from '../../src/repositories/opportunityFacets';
import { OrganizationRepository } from '../../src/repositories/organizationRepository';
import { OpportunityFeedbackRepository } from '../../src/repositories/opportunityFeedbackRepository';
import { handleOpportunitiesGet, situationValue } from '../../server/api/opportunities.get';

let counter = 0;
function make(overrides: Partial<OpportunityInput> = {}): OpportunityInput {
  counter += 1;
  return {
    pncpId: `F-${counter}`, source: 'PNCP', title: `t${counter}`, description: 'd', organization: 'o', state: 'SP',
    sourceUrl: 'https://x', publicationDate: '2026-03-10T10:00:00.000Z', estimatedValueCents: 0, ...overrides,
  };
}

function seed(items: Array<Partial<OpportunityInput>>) {
  const db = createTestDatabase();
  const repo = new OpportunityRepository(db);
  for (const item of items) repo.insert(make(item));
  return { db, repo };
}

const titles = (repo: OpportunityRepository, query: Parameters<OpportunityRepository['listCatalog']>[0]) =>
  repo.listCatalog({ pageSize: 50, ...query }).data.map((o) => o.title).sort();

describe('filtros de situação', () => {
  const items = [
    { title: 'a-null' }, { title: 'b-div', situation: 'Divulgada' }, { title: 'c-susp', situation: 'Suspensa' },
    { title: 'd-rev', situation: 'Revogada' }, { title: 'e-anul', situation: 'ANULADA' }, { title: 'f-des', situation: 'Deserta' },
    { title: 'g-fra', situation: 'Fracassada' }, { title: 'h-enc', situation: 'encerrada' }, { title: 'i-empty', situation: '' },
  ];
  it('open exclui encerradas e inclui null/vazio; padrão do repositório é all', () => {
    const { repo } = seed(items);
    expect(titles(repo, {})).toHaveLength(9);
    expect(titles(repo, { situationFilter: 'open' })).toEqual(['a-null', 'b-div', 'i-empty']);
  });
  it('suspended, cancelled e all', () => {
    const { repo } = seed(items);
    expect(titles(repo, { situationFilter: 'suspended' })).toEqual(['c-susp']);
    expect(titles(repo, { situationFilter: 'cancelled' })).toEqual(['d-rev', 'e-anul']);
    expect(titles(repo, { situationFilter: 'all' })).toHaveLength(9);
  });
});

describe('lookup por id', () => {
  it('encontra item suspenso com situationFilter all e opportunityId', () => {
    const { repo } = seed([{ title: 'susp', situation: 'Suspensa' }]);
    const id = repo.listCatalog({ situationFilter: 'all' }).data[0]!.id;
    expect(repo.listCatalog({ opportunityId: id, situationFilter: 'all', hideNotRelevant: false, pageSize: 1 }).data[0]?.title).toBe('susp');
    expect(repo.listCatalog({ situationFilter: 'open' }).data).toHaveLength(0);
  });
});

describe('demais filtros', () => {
  const items = [
    { title: 'x1', modality: 'Dispensa', city: 'São Paulo', disputeMode: 'Aberto', publicationDate: '2026-03-01T00:00:00.000Z', biddingDeadline: '2026-04-01T12:00:00.000Z' },
    { title: 'x2', modality: 'Pregão', city: 'Campinas', disputeMode: 'Fechado', publicationDate: '2026-03-05T23:59:00.000Z', biddingDeadline: '2026-04-05T00:00:00.000Z' },
    { title: 'x3', modality: ' Dispensa ', city: ' Niterói ', disputeMode: ' Aberto ', publicationDate: '2026-03-10T00:00:00.000Z', biddingDeadline: null, state: 'RJ' },
  ];
  it('modalities, city, disputeModes', () => {
    const { repo } = seed(items);
    expect(titles(repo, { modalities: ['Dispensa'] })).toEqual(['x1', 'x3']);
    expect(titles(repo, { modalities: ['Dispensa', 'Pregão'] })).toHaveLength(3);
    expect(titles(repo, { city: 'são paulo' })).toEqual(['x1']);
    expect(titles(repo, { city: 'campinas' })).toEqual(['x2']);
    expect(titles(repo, { city: 'Niterói' })).toEqual(['x3']);
    expect(titles(repo, { disputeModes: ['Aberto'] })).toEqual(['x1', 'x3']);
  });
  it('datas inclusivas', () => {
    const { repo } = seed(items);
    expect(titles(repo, { publishedFrom: '2026-03-05', publishedTo: '2026-03-05' })).toEqual(['x2']);
    expect(titles(repo, { publishedTo: '2026-03-01' })).toEqual(['x1']);
    expect(titles(repo, { deadlineFrom: '2026-04-05' })).toEqual(['x2']);
    expect(titles(repo, { deadlineTo: '2026-04-01' })).toEqual(['x1']);
  });
  it('combina com state e openDeadlineOnly', () => {
    const { repo } = seed([...items, { title: 'x4', modality: 'Dispensa', state: 'SP', biddingDeadline: '2999-01-01T00:00:00.000Z' }]);
    expect(titles(repo, { modalities: ['Dispensa'], state: 'SP' })).toEqual(['x1', 'x4']);
    expect(titles(repo, { modalities: ['Dispensa'], state: 'SP', openDeadlineOnly: true })).toEqual(['x4']);
  });
});

describe('parser da API', () => {
  const { repo } = seed([
    { title: 'p1', modality: 'Dispensa', situation: 'Suspensa', publicationDate: '2026-03-01T00:00:00.000Z' },
    { title: 'p2', modality: 'Pregão', publicationDate: '2026-03-02T00:00:00.000Z' },
  ]);
  const run = (query: Record<string, unknown>) =>
    handleOpportunitiesGet({ opportunities: repo, organizationId: 1, query }).data.map((o) => o.title).sort();
  it('lista por vírgula e situação inválida vira open', () => {
    expect(run({ modalities: 'Dispensa, Pregão' })).toEqual(['p2']);
    expect(run({ modalities: 'Dispensa,Pregão', situation: 'all' })).toEqual(['p1', 'p2']);
    expect(run({ situation: 'bogus' })).toEqual(['p2']);
    expect(run({ situation: 'suspended' })).toEqual(['p1']);
  });
  it('data inválida é ignorada', () => {
    expect(run({ publishedFrom: '2026-13', publishedTo: 'abc', situation: 'all' })).toEqual(['p1', 'p2']);
    expect(run({ publishedFrom: '2026-03-02', situation: 'all' })).toEqual(['p2']);
  });
});

describe('facetas', () => {
  const { db } = seed([
    { modality: 'Pregão', city: 'Campinas', disputeMode: 'Aberto', state: 'SP' },
    { modality: 'Dispensa', city: 'São Paulo', disputeMode: 'Fechado', state: 'SP' },
    { modality: 'Pregão', city: ' Niterói ', disputeMode: 'Aberto', state: 'RJ' },
    { modality: '', city: '', disputeMode: null, state: 'RJ' },
  ]);
  it('distintas, ordenadas e por estado', () => {
    const all = listOpportunityFacets(db);
    expect(all.modalities).toEqual(['Dispensa', 'Pregão']);
    expect(all.disputeModes).toEqual(['Aberto', 'Fechado']);
    expect(all.cities).toEqual(['Campinas', 'Niterói', 'São Paulo']);
    expect(listOpportunityFacets(db, 'RJ').cities).toEqual(['Niterói']);
  });
});

describe('padrão de situação no handler', () => {
  it('situationValue: open só na listagem simples; explícito sempre vence', () => {
    expect(situationValue({})).toBe('open');
    expect(situationValue({ kanbanOnly: 'true' })).toBe('all');
    expect(situationValue({ feedback: 'favorite' })).toBe('all');
    expect(situationValue({ feedback: 'not_relevant' })).toBe('all');
    expect(situationValue({ kanbanOnly: 'true', situation: 'open' })).toBe('open');
    expect(situationValue({ kanbanOnly: 'true', situation: 'bogus' })).toBe('open');
  });
  it('kanban e favoritos mostram itens suspensos/revogados; listagem simples oculta', () => {
    const db = createTestDatabase();
    const org = new OrganizationRepository(db).create('Org Situacao');
    const repo = new OpportunityRepository(db);
    const suspId = repo.insert(make({ title: 'tracked-susp', situation: 'Suspensa' }));
    const revId = repo.insert(make({ title: 'fav-rev', situation: 'Revogada' }));
    repo.addToKanban(org.id, suspId);
    new OpportunityFeedbackRepository(db).save(org.id, revId, 'FAVORITED');
    const run = (query: Record<string, unknown>) =>
      handleOpportunitiesGet({ opportunities: repo, organizationId: org.id, query }).data.map((o) => o.title);
    expect(run({ kanbanOnly: 'true' })).toEqual(['tracked-susp']);
    expect(run({ feedback: 'favorite' })).toEqual(['fav-rev']);
    expect(run({})).toEqual([]);
  });
});
