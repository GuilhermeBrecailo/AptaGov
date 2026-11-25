import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createTestDatabase } from '../../src/db/database';
import type { OpportunityInput } from '../../src/domain/types';
import { OpportunityRepository } from '../../src/repositories/opportunityRepository';
import { mapPncpRecord } from '../../src/services/syncService';

const base = { numeroControlePNCP: 'X-1', objetoCompra: 'Objeto' };

function input(overrides: Partial<OpportunityInput> = {}): OpportunityInput {
  return {
    pncpId: 'S-1', source: 'PNCP', title: 't', description: 'd', organization: 'o', state: 'SP',
    sourceUrl: 'https://x', publicationDate: '2026-01-01T00:00:00.000Z', estimatedValueCents: 0, ...overrides,
  };
}

describe('opportunity situation and dispute mode', () => {
  it('maps PNCP records', () => {
    const mapped = mapPncpRecord({ ...base, situacaoCompraNome: 'Suspensa', modoDisputaNome: 'Aberto' }, 'PNCP');
    expect(mapped.situation).toBe('Suspensa');
    expect(mapped.disputeMode).toBe('Aberto');
  });

  it('maps OPEN_DATA records', () => {
    const mapped = mapPncpRecord({ ...base, situacaoCompraNomePncp: 'Divulgada', modoDisputaNomePncp: 'Fechado' }, 'OPEN_DATA');
    expect(mapped.situation).toBe('Divulgada');
    expect(mapped.disputeMode).toBe('Fechado');
  });

  it('uses null when absent', () => {
    const mapped = mapPncpRecord(base);
    expect(mapped.situation).toBeNull();
    expect(mapped.disputeMode).toBeNull();
  });

  it('persists on insert and updates on upsert', () => {
    const repository = new OpportunityRepository(createTestDatabase());
    const first = repository.upsert(input({ situation: 'Divulgada', disputeMode: 'Aberto' }));
    expect(first.current.situation).toBe('Divulgada');
    expect(first.current.disputeMode).toBe('Aberto');
    const second = repository.upsert(input({ situation: 'Suspensa', disputeMode: null }));
    expect(second.current.situation).toBe('Suspensa');
    expect(second.current.disputeMode).toBeNull();
    expect(repository.upsert(input({ pncpId: 'S-2' })).current.situation).toBeNull();
  });

  it('backfills old rows from raw_json and ignores invalid json', () => {
    const db = createTestDatabase();
    db.exec('DROP INDEX idx_opportunities_situation; DROP INDEX idx_opportunities_state_city; DROP INDEX idx_opportunities_modality');
    db.exec('ALTER TABLE opportunities DROP COLUMN situation; ALTER TABLE opportunities DROP COLUMN dispute_mode');
    const insert = db.prepare(`INSERT INTO opportunities (pncp_id, source, title, description, organization, state, city, modality,
      source_url, publication_date, estimated_value_cents, raw_json, created_at, updated_at)
      VALUES (?, 'PNCP', 't', 'd', 'o', 'SP', '', '', 'u', '2026-01-01', 0, ?, 'n', 'n')`);
    insert.run('A', JSON.stringify({ situacaoCompraNome: 'Suspensa', modoDisputaNome: 'Aberto' }));
    insert.run('B', JSON.stringify({ situacaoCompraNomePncp: 'Divulgada', modoDisputaNomePncp: 'Fechado' }));
    insert.run('C', 'not json {');
    db.exec(readFileSync(resolve(__dirname, '../../migrations/034_opportunity_situation_dispute.sql'), 'utf8'));
    const rows = db.prepare('SELECT pncp_id, situation, dispute_mode FROM opportunities ORDER BY pncp_id').all();
    expect(rows).toEqual([
      { pncp_id: 'A', situation: 'Suspensa', dispute_mode: 'Aberto' },
      { pncp_id: 'B', situation: 'Divulgada', dispute_mode: 'Fechado' },
      { pncp_id: 'C', situation: null, dispute_mode: null },
    ]);
  });
});
