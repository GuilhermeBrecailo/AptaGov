import { describe, expect, it } from 'vitest';
import { createTestDatabase } from '../../src/db/database';
import { OrganizationRepository } from '../../src/repositories/organizationRepository';
import { OpportunityRepository } from '../../src/repositories/opportunityRepository';
import { OpportunityChangeRepository } from '../../src/repositories/opportunityChangeRepository';
import { syncRecords } from '../../src/services/syncService';
import { OpportunityChangeService } from '../../src/services/opportunityChangeService';

function buildRecord(overrides: Partial<Parameters<OpportunityRepository['insert']>[0]> & { pncpId: string }) {
  return {
    pncpId: overrides.pncpId,
    source: 'PNCP' as const,
    title: overrides.title ?? 'Pregão eletrônico de software',
    description: overrides.description ?? 'contratação de plataforma',
    organization: overrides.organization ?? 'Prefeitura Exemplo',
    state: overrides.state ?? 'SP',
    city: overrides.city ?? 'São Paulo',
    modality: overrides.modality ?? 'Pregão',
    sourceUrl: overrides.sourceUrl ?? `https://pncp.gov.br/${overrides.pncpId}`,
    publicationDate: overrides.publicationDate ?? '2026-09-01T10:00:00.000Z',
    biddingDeadline: overrides.biddingDeadline ?? '2026-09-10T18:00:00.000Z',
    estimatedValueCents: overrides.estimatedValueCents ?? 150_000,
    raw: overrides.raw ?? {
      dataAberturaSessaoPublica: '2026-09-11T09:00:00.000Z',
      dataInicioDisputa: '2026-09-11T09:30:00.000Z',
      situacaoCompra: 'RECEBIMENTO_PROPOSTAS',
      linkEdital: 'https://pncp.gov.br/edital.pdf',
      arquivos: [{ id: 'anexo-1', nome: 'edital.pdf', url: 'https://pncp.gov.br/edital.pdf' }],
    },
  };
}

describe('detecção de mudanças oficiais', () => {
  it('não emite evento quando o snapshot relevante não muda', async () => {
    const db = createTestDatabase();
    const repository = new OpportunityRepository(db);
    const changeService = new OpportunityChangeService(new OpportunityChangeRepository(db));

    await syncRecords([buildRecord({ pncpId: 'change-1' })], repository);
    const result = await syncRecords([buildRecord({
      pncpId: 'change-1',
      raw: {
        dataAberturaSessaoPublica: '2026-09-11T09:00:00.000Z',
        dataInicioDisputa: '2026-09-11T09:30:00.000Z',
        situacaoCompra: 'RECEBIMENTO_PROPOSTAS',
        linkEdital: 'https://pncp.gov.br/edital.pdf',
        arquivos: [{ id: 'anexo-1', nome: 'edital.pdf', url: 'https://pncp.gov.br/edital.pdf' }],
        campoIrrelevante: 'novo valor',
      },
    })], repository);

    expect(result.entries).toHaveLength(1);
    expect(changeService.detectAndRecord(result.entries[0]!.previous, result.entries[0]!.current)).toEqual([]);
  });

  it('emite uma mudança de prazo de proposta quando só o prazo muda', async () => {
    const db = createTestDatabase();
    const repository = new OpportunityRepository(db);
    const changes = new OpportunityChangeRepository(db);
    const changeService = new OpportunityChangeService(changes);

    await syncRecords([buildRecord({ pncpId: 'change-2' })], repository);
    const result = await syncRecords([buildRecord({
      pncpId: 'change-2',
      biddingDeadline: '2026-09-12T18:00:00.000Z',
    })], repository);

    const detected = changeService.detectAndRecord(result.entries[0]!.previous, result.entries[0]!.current);

    expect(detected).toHaveLength(1);
    expect(detected[0]).toMatchObject({
      type: 'PROPOSAL_DEADLINE',
      payload: {
        from: '2026-09-10T18:00:00.000Z',
        to: '2026-09-12T18:00:00.000Z',
      },
    });
    expect(changes.listForOrganization(999)).toEqual([]);
  });

  it('emite eventos independentes para sessão, resultado e atualização da fonte', async () => {
    const db = createTestDatabase();
    const organizations = new OrganizationRepository(db);
    const organization = organizations.create('Empresa Change');
    const repository = new OpportunityRepository(db);
    const changeRepository = new OpportunityChangeRepository(db);
    const changeService = new OpportunityChangeService(changeRepository);

    await syncRecords([buildRecord({ pncpId: 'change-3' })], repository);
    const updated = await syncRecords([buildRecord({
      pncpId: 'change-3',
      description: 'contratação de plataforma com suporte',
      raw: {
        dataAberturaSessaoPublica: '2026-09-12T09:00:00.000Z',
        dataInicioDisputa: '2026-09-11T09:30:00.000Z',
        situacaoCompra: 'HOMOLOGADO',
        linkEdital: 'https://pncp.gov.br/edital-v2.pdf',
        arquivos: [{ id: 'anexo-2', nome: 'edital-v2.pdf', url: 'https://pncp.gov.br/edital-v2.pdf' }],
      },
    })], repository);
    repository.addToKanban(organization.id, updated.entries[0]!.current.opportunityId);

    const detected = changeService.detectAndRecord(updated.entries[0]!.previous, updated.entries[0]!.current);

    expect(detected.map((event) => event.type)).toEqual([
      'SESSION_OPENING',
      'CLOSING_RESULT',
      'SOURCE_UPDATE',
    ]);
    expect(changeRepository.listForOrganization(organization.id, updated.entries[0]!.current.opportunityId)).toHaveLength(3);
  });

  it('emite uma mudança de início da disputa sem confundi-la com a abertura da sessão', async () => {
    const db = createTestDatabase();
    const repository = new OpportunityRepository(db);
    const changeService = new OpportunityChangeService(new OpportunityChangeRepository(db));

    await syncRecords([buildRecord({ pncpId: 'change-4' })], repository);
    const result = await syncRecords([buildRecord({
      pncpId: 'change-4',
      raw: {
        dataAberturaSessaoPublica: '2026-09-11T09:00:00.000Z',
        dataInicioDisputa: '2026-09-11T10:00:00.000Z',
        situacaoCompra: 'RECEBIMENTO_PROPOSTAS',
        linkEdital: 'https://pncp.gov.br/edital.pdf',
        arquivos: [{ id: 'anexo-1', nome: 'edital.pdf', url: 'https://pncp.gov.br/edital.pdf' }],
      },
    })], repository);
    const detected = changeService.detectAndRecord(result.entries[0]!.previous, result.entries[0]!.current);

    expect(detected).toMatchObject([{
      type: 'DISPUTE_START',
      payload: {
        from: '2026-09-11T09:30:00.000Z',
        to: '2026-09-11T10:00:00.000Z',
      },
    }]);
  });
});
