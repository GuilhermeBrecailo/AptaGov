import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadEnv } from '../../src/config/env';
import { createTestDatabase } from '../../src/db/database';
import { emptyCompanyProfile, type CompanyProfile } from '../../src/domain/companyProfile';
import { CompanyProfileRepository } from '../../src/repositories/companyProfileRepository';
import { logger } from '../../src/observability/logger';
import { EditalAnalysisRepository } from '../../src/repositories/editalAnalysisRepository';
import { OpportunityRepository } from '../../src/repositories/opportunityRepository';
import { OrganizationRepository } from '../../src/repositories/organizationRepository';
import { ExtractionFailedError, estimateCostUsdMicros, type EditalExtractor, type ExtractionResult } from '../../src/services/edital/claudeExtractor';
import { EditalAnalysisService } from '../../src/services/edital/editalAnalysisService';
import type { EditalExtraction } from '../../src/services/edital/extraction';
import { PncpDocumentClient } from '../../src/services/edital/pncpDocuments';

type Db = ReturnType<typeof createTestDatabase>;
type FileEntry = { sequencialDocumento: number; tipoDocumentoNome: string; titulo: string; url: string };

const PNCP_ID = '12345678000190-1-000123/2026';
const NOW = new Date('2026-11-24T12:00:00Z');

const MB = 1024 * 1024;
const PDF = Buffer.from('%PDF-1.4 conteúdo de teste');

const DEFAULT_FILES: FileEntry[] = [
  { sequencialDocumento: 1, tipoDocumentoNome: 'Edital', titulo: 'edital-v1.pdf', url: 'https://pncp.test/files/1' },
  { sequencialDocumento: 2, tipoDocumentoNome: 'Termo de Referência', titulo: 'tr.pdf', url: 'https://pncp.test/files/2' },
  { sequencialDocumento: 3, tipoDocumentoNome: 'Edital', titulo: 'edital-v2.pdf', url: 'https://pncp.test/files/3' },
  { sequencialDocumento: 4, tipoDocumentoNome: 'Minuta do Contrato', titulo: 'minuta.pdf', url: 'https://pncp.test/files/4' }
];

const EXTRACTION: EditalExtraction = {
  summary: {
    object: 'Construção de escola',
    estimatedValueCents: 100_000_000,
    openingAt: null,
    modality: 'Concorrência',
    executionRegime: null,
    judgmentCriterion: null,
    allowsConsortium: null,
    lots: []
  },
  requirements: [
    {
      id: 'r1',
      lot: null,
      category: 'net_worth',
      description: 'Patrimônio líquido mínimo',
      page: 12,
      excerpt: 'patrimônio líquido mínimo de R$ 100.000,00',
      mandatory: true,
      alternativeGroup: null,
      conditional: false,
      minQuantity: null,
      unit: null,
      allowsSum: null,
      percentOfEstimate: null,
      amountCents: 10_000_000,
      ratioName: null,
      minRatio: null,
      council: null,
      deadline: null
    }
  ],
  matches: []
};

function profileWithNetWorth(netWorthCents: number): CompanyProfile {
  const profile = emptyCompanyProfile();
  profile.financial.netWorthCents = netWorthCents;
  return profile;
}

function fakeFetch(files: FileEntry[], sizes: Record<string, number> = {}): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith('/arquivos')) return new Response(JSON.stringify(files), { status: 200 });
    const size = sizes[url];
    if (size === undefined) return new Response(PDF, { status: 200 });
    const body = Buffer.alloc(size);
    PDF.copy(body);
    return new Response(body, { status: 200 });
  }) as typeof fetch;
}

class FakeExtractor implements EditalExtractor {
  calls: Array<Parameters<EditalExtractor['extract']>[0]> = [];
  constructor(private readonly behavior: () => Promise<ExtractionResult> = async () => ({
    extraction: EXTRACTION,
    model: 'claude-opus-5-5',
    inputTokens: 50_000,
    outputTokens: 4_000
  })) {}

  async extract(input: Parameters<EditalExtractor['extract']>[0]): Promise<ExtractionResult> {
    this.calls.push(input);
    return this.behavior();
  }
}

function setup(options: {
  allow?: boolean;
  extractor?: EditalExtractor | null;
  files?: FileEntry[];
  pncpId?: string;
  limit?: number;
  sizes?: Record<string, number>;
} = {}) {
  const db: Db = createTestDatabase();
  const organization = new OrganizationRepository(db).create('Construtora Teste');
  const opportunityId = new OpportunityRepository(db).insert({
    pncpId: options.pncpId ?? PNCP_ID,
    title: 'Obra',
    description: '',
    organization: 'Prefeitura',
    state: 'SP',
    sourceUrl: 'https://pncp.gov.br/x',
    publicationDate: '2026-11-01T10:00:00.000Z',
    estimatedValueCents: 100_000_000
  });
  const env = loadEnv({
    NODE_ENV: 'test',
    ANTHROPIC_API_KEY: 'test-key',
    EDITAL_ANALYSIS_ORGANIZATION_IDS: options.allow === false ? '' : String(organization.id),
    EDITAL_ANALYSIS_MONTHLY_LIMIT: String(options.limit ?? 30)
  });
  const extractor = options.extractor === undefined ? new FakeExtractor() : options.extractor;
  const profiles = new CompanyProfileRepository(db);
  profiles.save(organization.id, profileWithNetWorth(50_000_000));
  const service = new EditalAnalysisService({
    db,
    env,
    extractor,
    documents: new PncpDocumentClient(fakeFetch(options.files ?? DEFAULT_FILES, options.sizes)),
    now: () => NOW
  });
  const repository = new EditalAnalysisRepository(db);
  return { db, organizationId: organization.id, opportunityId, service, repository, profiles, extractor };
}

async function waitForStatus(repository: EditalAnalysisRepository, orgId: number, oppId: number, status: string) {
  await vi.waitFor(() => {
    expect(repository.latest(orgId, oppId, NOW)?.status).toBe(status);
  });
}

/** Keeps `start` from scheduling the background run, so the test drives `run` directly. */
function disableScheduling() {
  vi.spyOn(globalThis, 'setImmediate').mockImplementation((() => undefined) as unknown as typeof setImmediate);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('EditalAnalysisService', () => {
  it('fluxo feliz grava COMPLETED com tokens e custo, e a view devolve os lotes', async () => {
    const { service, repository, organizationId, opportunityId, extractor } = setup();

    const started = service.start(organizationId, opportunityId);
    expect(started.status).toBe('RUNNING');
    await waitForStatus(repository, organizationId, opportunityId, 'COMPLETED');

    const record = repository.latest(organizationId, opportunityId, NOW)!;
    expect(record.id).toBe(started.id);
    expect(record.inputTokens).toBe(50_000);
    expect(record.outputTokens).toBe(4_000);
    expect(record.costUsdMicros).toBe(estimateCostUsdMicros('claude-opus-5-5', 50_000, 4_000));
    expect(record.model).toBe('claude-opus-5-5');
    expect(record.partial).toBe(false);
    expect(record.error).toBeNull();
    expect(record.extraction).toEqual(EXTRACTION);
    expect(record.documents).toEqual([
      { kind: 'EDITAL', title: 'edital-v2.pdf', url: 'https://pncp.test/files/3', included: true, reason: null },
      { kind: 'TERMO_REFERENCIA', title: 'tr.pdf', url: 'https://pncp.test/files/2', included: true, reason: null },
      { kind: 'EDITAL', title: 'edital-v1.pdf', url: 'https://pncp.test/files/1', included: false, reason: 'Versão anterior' }
    ]);

    const fake = extractor as FakeExtractor;
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]!.documents.map((doc) => doc.title)).toEqual(['edital-v2.pdf', 'tr.pdf']);

    const view = service.view(organizationId, opportunityId);
    expect(view.enabled).toBe(true);
    expect(view.disabledReason).toBeNull();
    expect(view.analysis?.id).toBe(started.id);
    expect(view.lots).toHaveLength(1);
    expect(view.lots[0]!.verdict).toBe('APT');
    expect(view.profileChanged).toBe(false);
    expect(view.profileEmpty).toBe(false);
  });

  it('organização fora da allowlist recebe 403', () => {
    const { service, organizationId, opportunityId } = setup({ allow: false });
    expect(service.availability(organizationId)).toEqual({ enabled: false, reason: 'Análise de edital não liberada para sua empresa' });
    expect(() => service.start(organizationId, opportunityId)).toThrowError(
      expect.objectContaining({ statusCode: 403, message: 'Análise de edital não liberada para sua empresa' })
    );
  });

  it('sem extrator (sem chave) responde 503', () => {
    const { service, organizationId, opportunityId } = setup({ extractor: null });
    expect(service.availability(organizationId)).toEqual({ enabled: false, reason: 'Configure ANTHROPIC_API_KEY para analisar editais' });
    expect(() => service.start(organizationId, opportunityId)).toThrowError(
      expect.objectContaining({ statusCode: 503, message: 'Configure ANTHROPIC_API_KEY para analisar editais' })
    );
    expect(service.view(organizationId, opportunityId).enabled).toBe(false);
  });

  it('oportunidade inexistente responde 404', () => {
    const { service, organizationId } = setup();
    expect(() => service.start(organizationId, 999_999)).toThrowError(expect.objectContaining({ statusCode: 404 }));
  });

  it('segunda chamada com RUNNING existente devolve o mesmo id e o extrator roda uma vez', async () => {
    const { service, repository, organizationId, opportunityId, extractor } = setup();
    const scheduled = vi.spyOn(globalThis, 'setImmediate');

    const first = service.start(organizationId, opportunityId);
    const second = service.start(organizationId, opportunityId);
    expect(second.id).toBe(first.id);
    expect(scheduled).toHaveBeenCalledTimes(1);

    await waitForStatus(repository, organizationId, opportunityId, 'COMPLETED');
    expect((extractor as FakeExtractor).calls).toHaveLength(1);
  });

  it('30 análises no mês respondem 429; meses anteriores não contam', () => {
    const { service, repository, organizationId, opportunityId } = setup();
    repository.createRunning(organizationId, 5_000, 'hash', new Date('2026-10-31T23:59:59Z'));
    for (let index = 0; index < 29; index += 1) {
      const record = repository.createRunning(organizationId, 1_000 + index, 'hash', NOW);
      repository.fail(record.id, 'qualquer', undefined, NOW);
    }
    expect(repository.countThisMonth(organizationId, NOW)).toBe(29);
    repository.createRunning(organizationId, 2_000, 'hash', new Date('2026-11-01T00:00:00Z'));
    expect(repository.countThisMonth(organizationId, NOW)).toBe(30);

    expect(() => service.start(organizationId, opportunityId)).toThrowError(
      expect.objectContaining({ statusCode: 429, message: 'Limite mensal de análises atingido' })
    );
  });

  it('só ZIP termina FAILED com a mensagem de formato e não chama o extrator', async () => {
    const files: FileEntry[] = [
      { sequencialDocumento: 1, tipoDocumentoNome: 'Edital', titulo: 'edital.zip', url: 'https://pncp.test/files/1' },
      { sequencialDocumento: 2, tipoDocumentoNome: 'Termo de Referência', titulo: 'tr.zip', url: 'https://pncp.test/files/2' }
    ];
    const { service, repository, organizationId, opportunityId, extractor } = setup({ files });

    service.start(organizationId, opportunityId);
    await waitForStatus(repository, organizationId, opportunityId, 'FAILED');

    const record = repository.latest(organizationId, opportunityId, NOW)!;
    expect(record.error).toBe('Edital em formato não suportado (ZIP/DOCX) — abra pelo link');
    expect(record.documents).toEqual([
      { kind: 'EDITAL', title: 'edital.zip', url: 'https://pncp.test/files/1', included: false, reason: 'Formato não suportado' },
      { kind: 'TERMO_REFERENCIA', title: 'tr.zip', url: 'https://pncp.test/files/2', included: false, reason: 'Formato não suportado' }
    ]);
    expect((extractor as FakeExtractor).calls).toHaveLength(0);
  });

  it('TR em ZIP fica de fora e a análise é marcada parcial', async () => {
    const files: FileEntry[] = [
      { sequencialDocumento: 1, tipoDocumentoNome: 'Edital', titulo: 'edital.pdf', url: 'https://pncp.test/files/1' },
      { sequencialDocumento: 2, tipoDocumentoNome: 'Termo de Referência', titulo: 'tr.zip', url: 'https://pncp.test/files/2' }
    ];
    disableScheduling();
    const { service, repository, organizationId, opportunityId } = setup({ files });
    const record = service.start(organizationId, opportunityId);
    await service.run(record.id);

    const done = repository.latest(organizationId, opportunityId, NOW)!;
    expect(done.status).toBe('COMPLETED');
    expect(done.partial).toBe(true);
    expect(done.documents[1]).toMatchObject({ kind: 'TERMO_REFERENCIA', included: false, reason: 'Formato não suportado' });
  });

  it('TR que estoura o orçamento fica de fora e a análise é parcial', async () => {
    disableScheduling();
    const { service, repository, organizationId, opportunityId, extractor } = setup({
      sizes: { 'https://pncp.test/files/3': 20 * MB, 'https://pncp.test/files/2': 5 * MB }
    });
    const record = service.start(organizationId, opportunityId);
    await service.run(record.id);

    const done = repository.latest(organizationId, opportunityId, NOW)!;
    expect(done.status).toBe('COMPLETED');
    expect(done.partial).toBe(true);
    expect(done.documents[1]).toMatchObject({ kind: 'TERMO_REFERENCIA', included: false, reason: 'Excede o limite de tamanho' });
    expect((extractor as FakeExtractor).calls[0]!.documents.map((doc) => doc.kind)).toEqual(['EDITAL']);
  });

  it('Edital sozinho acima do orçamento termina FAILED sem chamar o extrator', async () => {
    disableScheduling();
    const { service, repository, organizationId, opportunityId, extractor } = setup({
      sizes: { 'https://pncp.test/files/3': 25 * MB }
    });
    const record = service.start(organizationId, opportunityId);
    await service.run(record.id);

    const failed = repository.latest(organizationId, opportunityId, NOW)!;
    expect(failed.status).toBe('FAILED');
    expect(failed.error).toBe('Edital grande demais para análise automática — abra pelo link');
    expect(failed.documents[0]).toMatchObject({ kind: 'EDITAL', included: false, reason: 'Excede o limite de tamanho' });
    expect((extractor as FakeExtractor).calls).toHaveLength(0);
  });

  it('pncp_id inválido ou sem documentos falha com "Edital não disponível no PNCP"', async () => {
    disableScheduling();
    const invalid = setup({ pncpId: 'BEC-123' });
    const first = invalid.service.start(invalid.organizationId, invalid.opportunityId);
    await invalid.service.run(first.id);
    expect(invalid.repository.latest(invalid.organizationId, invalid.opportunityId, NOW)).toMatchObject({
      status: 'FAILED',
      error: 'Edital não disponível no PNCP'
    });

    const empty = setup({ files: [] });
    const second = empty.service.start(empty.organizationId, empty.opportunityId);
    await empty.service.run(second.id);
    expect(empty.repository.latest(empty.organizationId, empty.opportunityId, NOW)).toMatchObject({
      status: 'FAILED',
      error: 'Edital não disponível no PNCP'
    });
  });

  it('RUNNING com updated_at de 16 min atrás vira FAILED "Análise interrompida" na leitura', () => {
    const { repository, organizationId, opportunityId } = setup();
    const record = repository.createRunning(organizationId, opportunityId, 'hash', new Date(NOW.getTime() - 16 * 60_000));

    const latest = repository.latest(organizationId, opportunityId, NOW)!;
    expect(latest.id).toBe(record.id);
    expect(latest.status).toBe('FAILED');
    expect(latest.error).toBe('Análise interrompida');

    const fresh = repository.createRunning(organizationId, opportunityId + 1, 'hash', new Date(NOW.getTime() - 14 * 60_000));
    expect(repository.latest(organizationId, opportunityId + 1, NOW)).toMatchObject({ id: fresh.id, status: 'RUNNING' });
  });

  it('extrator lançando ExtractionFailedError termina FAILED com a mensagem dele', async () => {
    const extractor = new FakeExtractor(async () => {
      throw new ExtractionFailedError('A IA recusou analisar este edital — abra pelo link e confira manualmente');
    });
    disableScheduling();
    const { service, repository, organizationId, opportunityId } = setup({ extractor });

    const record = service.start(organizationId, opportunityId);
    await service.run(record.id);

    const failed = repository.latest(organizationId, opportunityId, NOW)!;
    expect(failed.status).toBe('FAILED');
    expect(failed.error).toBe('A IA recusou analisar este edital — abra pelo link e confira manualmente');
  });

  it('erro inesperado do extrator grava mensagem genérica sem vazar o texto original', async () => {
    const extractor = new FakeExtractor(async () => {
      throw new Error('401 invalid x-api-key sk-ant-secret');
    });
    disableScheduling();
    const { service, repository, organizationId, opportunityId } = setup({ extractor });

    const logged = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    const record = service.start(organizationId, opportunityId);
    await expect(service.run(record.id)).resolves.toBeUndefined();
    expect(logged).toHaveBeenCalledTimes(1);

    const failed = repository.latest(organizationId, opportunityId, NOW)!;
    expect(failed.status).toBe('FAILED');
    expect(failed.error).toBe('Falha ao analisar o edital. Tente novamente mais tarde.');
    expect(failed.error).not.toContain('sk-ant');
  });

  it('mudar o perfil depois da análise marca profileChanged', async () => {
    disableScheduling();
    const { service, profiles, organizationId, opportunityId } = setup();
    const record = service.start(organizationId, opportunityId);
    await service.run(record.id);
    expect(service.view(organizationId, opportunityId).profileChanged).toBe(false);

    profiles.save(organizationId, profileWithNetWorth(1_000));
    const view = service.view(organizationId, opportunityId);
    expect(view.profileChanged).toBe(true);
    expect(view.lots[0]!.verdict).toBe('NOT_APT');
  });

  it('view sem análise e com perfil vazio', () => {
    const { service, profiles, organizationId, opportunityId } = setup();
    profiles.save(organizationId, emptyCompanyProfile());
    expect(service.view(organizationId, opportunityId)).toEqual({
      enabled: true,
      disabledReason: null,
      analysis: null,
      lots: [],
      profileChanged: false,
      profileEmpty: true
    });
  });
});
