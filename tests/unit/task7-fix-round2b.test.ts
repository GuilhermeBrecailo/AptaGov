import { describe, expect, it } from 'vitest';
import { createTestDatabase } from '../../src/db/database';
import { JobRepository } from '../../src/repositories/jobRepository';
import { OperationalOutboxRepository } from '../../src/repositories/operationalOutboxRepository';
import { OrganizationRepository } from '../../src/repositories/organizationRepository';
import { SourceSyncService } from '../../src/services/sourceSyncService';
import { WorkerRuntime } from '../../src/workerRuntime';
import { loadEnv } from '../../src/config/env';

describe('Task 7 fix round 2: retry e lease duráveis', () => {
  it('não reivindica uma falha da outbox imediatamente no mesmo ciclo', () => {
    const db = createTestDatabase();
    const repository = new OperationalOutboxRepository(db);
    repository.enqueue({ eventKey: 'outbox:retry:1', eventType: 'OPPORTUNITY_SYNCED', payload: {} });

    const claimed = repository.claimNext('worker-a', 60_000);
    expect(claimed).toBeDefined();
    expect(repository.fail(claimed!.id, 'falha transitória', 'worker-a')).toBe(true);

    expect(repository.claimNext('worker-a', 60_000)).toBeUndefined();
    expect(repository.find(claimed!.id)).toMatchObject({ status: 'FAILED', attempts: 1 });
    expect(repository.find(claimed!.id)?.nextRetryAt).toBeTruthy();
  });

  it('para de reivindicar o evento depois do limite de tentativas', () => {
    const db = createTestDatabase();
    const repository = new OperationalOutboxRepository(db);
    repository.enqueue({ eventKey: 'outbox:retry:max', eventType: 'OPPORTUNITY_SYNCED', payload: {} });

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const claimed = repository.claimNext('worker-a', 60_000);
      expect(claimed).toBeDefined();
      expect(repository.fail(claimed!.id, `falha ${attempt + 1}`, 'worker-a')).toBe(true);
      db.prepare('UPDATE worker_outbox SET next_retry_at = ? WHERE id = ?').run('2000-01-01T00:00:00.000Z', claimed!.id);
    }

    expect(repository.claimNext('worker-a', 60_000)).toBeUndefined();
    expect(repository.listPending()).toHaveLength(1);
    expect(repository.listPending()[0]?.attempts).toBe(5);
  });

  it('mantém uma única reserva para a mesma chave mesmo depois da conclusão', () => {
    const db = createTestDatabase();
    const repository = new JobRepository(db);
    const first = repository.reserve('source_sync', { jobKey: 'cycle:1' }, 'cycle:1');
    expect(first.created).toBe(true);
    expect(repository.claim(first.id, 'worker-a', 60_000)).toBe(true);
    expect(repository.markCompleted(first.id, 'worker-a')).toBe(true);

    const second = repository.reserve('source_sync', { jobKey: 'cycle:1' }, 'cycle:1');
    expect(second).toEqual({ id: first.id, created: false });
    expect(repository.list().filter((job) => job.operationalKey === 'cycle:1')).toHaveLength(1);
  });

  it('restringe conclusão e renovação ao owner atual do lease', () => {
    const db = createTestDatabase();
    const repository = new JobRepository(db);
    const job = repository.reserve('source_sync', { jobKey: 'cycle:owner' }, 'cycle:owner');
    expect(repository.claim(job.id, 'worker-a', 60_000)).toBe(true);
    expect(repository.renew(job.id, 'worker-b', 60_000)).toBe(false);
    expect(repository.markCompleted(job.id, 'worker-b')).toBe(false);
    expect(repository.renew(job.id, 'worker-a', 60_000)).toBe(true);
    expect(repository.find(job.id)?.leaseOwner).toBe('worker-a');
    expect(repository.markCompleted(job.id, 'worker-a')).toBe(true);
  });

  it('renova o lease durante uma sincronização longa', async () => {
    const db = createTestDatabase();
    const organization = new OrganizationRepository(db).create('Empresa Lease');
    let leaseBefore: string | null = null;
    let leaseAfter: string | null = null;
    const sourceSyncService = {
      run: async () => {
        const job = new JobRepository(db).list('RUNNING')[0];
        leaseBefore = job?.leaseUntil ?? null;
        await new Promise((resolve) => setTimeout(resolve, 50));
        leaseAfter = job ? new JobRepository(db).find(job.id)?.leaseUntil ?? null : null;
        return { sourceResults: [], received: 0, persisted: 0, created: 0, updated: 0, entries: [] };
      },
    } as unknown as SourceSyncService;
    const runtime = new WorkerRuntime(loadEnv({
      NODE_ENV: 'test',
      DATABASE_URL: ':memory:',
      WORKER_LEASE_MS: '20',
    }), db, { sourceClients: [], sourceSyncService });

    await runtime.runCycle({ mode: 'manual', organizationId: organization.id });

    expect(leaseBefore).toBeTruthy();
    expect(leaseAfter).toBeTruthy();
    expect(new Date(leaseAfter!).getTime()).toBeGreaterThan(new Date(leaseBefore!).getTime());
    runtime.close();
  });
});
