import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { isOrganizationOwner } from '../../src/auth/authorization';
import { createTestDatabase } from '../../src/db/database';
import { OpportunityRepository } from '../../src/repositories/opportunityRepository';
import { OrganizationRepository } from '../../src/repositories/organizationRepository';
import { handleOpportunityMarketGet } from '../../server/api/opportunities/[id]/market.get';

it('protege as duas consultas de mercado com autenticação e billing ativo', () => {
  const root = resolve(process.cwd());
  expect(readFileSync(resolve(root, 'server/api/market.get.ts'), 'utf8')).toContain("requireActiveBilling(event, 'catalog')");
  expect(readFileSync(resolve(root, 'server/api/opportunities/[id]/market.get.ts'), 'utf8')).toContain("requireActiveBilling(event, 'catalog')");
});

describe('autorizaÃ§Ã£o operacional', () => {
  it('permite pausar e retomar o worker somente ao proprietÃ¡rio', () => {
    expect(isOrganizationOwner({ role: 'OWNER' })).toBe(true);
    expect(isOrganizationOwner({ role: 'MEMBER' })).toBe(false);
  });

  it('não expõe comparação de mercado de oportunidade fora do vínculo da organização', () => {
    const db = createTestDatabase();
    const opportunities = new OpportunityRepository(db);
    const opportunityId = opportunities.insert({
      pncpId: 'authorization-market-1',
      title: 'Oportunidade',
      description: 'Descrição',
      organization: 'Órgão',
      state: 'SP',
      sourceUrl: 'https://pncp.gov.br/authorization-market-1',
      publicationDate: '2026-09-01T00:00:00.000Z',
      estimatedValueCents: 0,
      raw: { codigoItem: 'ITEM-1', descricaoItem: 'descrição', unidadeFornecimento: 'UN' },
    });
    const organizationId = new OrganizationRepository(db).create('Empresa autorizada').id;
    opportunities.addToKanban(organizationId, opportunityId);

    expect(() => handleOpportunityMarketGet({
      opportunities,
      organizationId: organizationId + 1,
      opportunityId,
      service: { getMarketSummary: () => ({ state: 'READY' }) } as never,
    })).toThrow(/não encontrada/i);
  });
});
