import { describe, expect, it } from 'vitest';
import { createTestDatabase } from '../../src/db/database';
import { JobRepository } from '../../src/repositories/jobRepository';

describe('retomada do worker', () => {
  it('recoloca jobs RUNNING como PENDING ao iniciar', () => {
    const db = createTestDatabase();
    const repository = new JobRepository(db);
    const jobId = repository.create('sync');
    repository.markRunning(jobId);

    repository.recoverInterrupted();

    expect(repository.find(jobId)?.status).toBe('PENDING');
  });
});
