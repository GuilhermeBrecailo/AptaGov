import { describe, expect, it } from 'vitest';
import { createTestDatabase } from '../../src/db/database';
import { OpportunityRepository } from '../../src/repositories/opportunityRepository';
import { syncRecords } from '../../src/services/syncService';

describe('syncRecords', () => {
  it('não duplica uma contratação quando o PNCP a retorna novamente', async () => {
    const db = createTestDatabase();
    const repository = new OpportunityRepository(db);
    const record = {
      pncpId: '12345678901234-1-000001/2026',
      title: 'Sistema de atendimento',
      description: 'Software',
      state: 'SP',
      organization: 'Órgão de teste',
      sourceUrl: 'https://pncp.gov.br/pncp-api/v1/contratacoes/123',
      publicationDate: '2026-08-31T10:00:00.000Z',
      estimatedValueCents: 100_000,
    };

    await syncRecords([record, record], repository);

    expect(repository.count()).toBe(1);
    expect(repository.findByPncpId(record.pncpId)?.pncpId).toBe(record.pncpId);
  });
});
