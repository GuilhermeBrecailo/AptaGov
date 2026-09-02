import { describe, expect, it } from 'vitest';
import { createTestDatabase } from '../../src/db/database';
import { JobRepository } from '../../src/repositories/jobRepository';

describe('retomada do worker', () => {
  it('recoloca jobs RUNNING como PENDING ao iniciar', () => {
    const db = createTestDatabase();
    const repository = new JobRepository(db);
    const jobId = repository.create('sync');
    repository.markRunning(jobId, 'crashed-runtime', -1);

    repository.recoverInterrupted();

    expect(repository.find(jobId)?.status).toBe('PENDING');
  });

  it('persiste checkpoint e suporta os tipos duraveis do ciclo', () => {
    const db = createTestDatabase();
    const repository = new JobRepository(db);
    const source = repository.create('source_sync', { source: 'PNCP', cursor: 'page:2' }, 'source:PNCP:window');
    const agenda = repository.create('agenda_preparation', { organizationId: 1 }, 'agenda:1:cycle');
    const market = repository.create('market_refresh', { dateFrom: '2026-08-01' }, 'market:2026-08-01');

    expect(repository.claim(source, 'restart-test-owner')).toBe(true);
    expect(repository.updateCheckpoint(source, { source: 'PNCP', cursor: 'page:3' }, 'restart-test-owner')).toBe(true);

    expect(repository.find(source)).toMatchObject({ type: 'source_sync', checkpoint: { cursor: 'page:3' } });
    expect(repository.find(agenda)?.type).toBe('agenda_preparation');
    expect(repository.find(market)?.type).toBe('market_refresh');
  });
});
