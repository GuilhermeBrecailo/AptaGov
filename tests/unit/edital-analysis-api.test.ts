import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadEnv } from '../../src/config/env';
import { createTestDatabase } from '../../src/db/database';
import { OpportunityRepository } from '../../src/repositories/opportunityRepository';
import { OrganizationRepository } from '../../src/repositories/organizationRepository';
import type { EditalExtractor } from '../../src/services/edital/claudeExtractor';
import { EditalAnalysisService } from '../../src/services/edital/editalAnalysisService';
import { PncpDocumentClient } from '../../src/services/edital/pncpDocuments';
import { handleEditalAnalysisGet } from '../../server/api/opportunities/[id]/edital-analysis.get';
import { handleEditalAnalysisPost } from '../../server/api/opportunities/[id]/edital-analysis.post';

function setup() {
  const db = createTestDatabase();
  const organizations = new OrganizationRepository(db);
  const org = organizations.create('Construtora A');
  const other = organizations.create('Construtora B');
  const opportunityId = new OpportunityRepository(db).insert({
    pncpId: '12345678000190-1-000123/2026',
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
    EDITAL_ANALYSIS_ORGANIZATION_IDS: `${org.id},${other.id}`
  });
  const extractor: EditalExtractor = { extract: () => new Promise(() => undefined) };
  const fetchMock = vi.fn(async () => new Response('[]', { status: 200 }));
  const service = new EditalAnalysisService({
    db,
    env,
    extractor,
    documents: new PncpDocumentClient(fetchMock as unknown as typeof fetch)
  });
  return { service, orgId: org.id, otherId: other.id, opportunityId };
}

afterEach(() => vi.restoreAllMocks());

describe('edital analysis endpoints', () => {
  it('GET sem análise devolve analysis null e enabled conforme a allowlist', () => {
    const { service, orgId, opportunityId } = setup();
    const view = handleEditalAnalysisGet({ service, organizationId: orgId, opportunityId });
    expect(view.analysis).toBeNull();
    expect(view.enabled).toBe(true);
    expect(handleEditalAnalysisGet({ service, organizationId: 9999, opportunityId }).enabled).toBe(false);
  });

  it('POST inicia a análise e o GET seguinte mostra RUNNING', () => {
    const { service, orgId, opportunityId } = setup();
    const started = handleEditalAnalysisPost({ service, organizationId: orgId, opportunityId });
    expect(started.analysis?.status).toBe('RUNNING');
    const view = handleEditalAnalysisGet({ service, organizationId: orgId, opportunityId });
    expect(view.analysis?.status).toBe('RUNNING');
  });

  it('id não inteiro devolve 400', () => {
    const { service, orgId } = setup();
    expect(() => handleEditalAnalysisGet({ service, organizationId: orgId, opportunityId: Number('abc') }))
      .toThrowError(expect.objectContaining({ statusCode: 400 }));
    expect(() => handleEditalAnalysisPost({ service, organizationId: orgId, opportunityId: Number('abc') }))
      .toThrowError(expect.objectContaining({ statusCode: 400 }));
  });

  it('não expõe a análise de outra organização', () => {
    const { service, orgId, otherId, opportunityId } = setup();
    handleEditalAnalysisPost({ service, organizationId: orgId, opportunityId });
    const view = handleEditalAnalysisGet({ service, organizationId: otherId, opportunityId });
    expect(view.analysis).toBeNull();
  });
});
