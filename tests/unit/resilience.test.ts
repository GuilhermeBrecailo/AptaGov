import { describe, expect, it } from 'vitest';
import { CircuitBreaker } from '../../src/resilience/circuitBreaker';
import { withRetry } from '../../src/resilience/retry';
import { createTestDatabase } from '../../src/db/database';
import { SystemStateRepository } from '../../src/repositories/systemStateRepository';
import { classifySourceError } from '../../src/services/sourceSyncService';

describe('resiliência externa', () => {
  it('faz retry com backoff injetável antes de desistir', async () => {
    let attempts = 0;
    const delays: number[] = [];
    const result = await withRetry(async () => {
      attempts += 1;
      if (attempts < 3) throw new Error('temporário');
      return 'ok';
    }, { maxRetries: 3, baseDelayMs: 10, sleep: async (delay) => { delays.push(delay); } });

    expect(result).toBe('ok');
    expect(attempts).toBe(3);
    expect(delays).toHaveLength(2);
  });

  it('abre o circuito após falhas consecutivas', async () => {
    const breaker = new CircuitBreaker(2, 60_000);
    await expect(breaker.execute(async () => { throw new Error('fora do ar'); })).rejects.toThrow('fora do ar');
    await expect(breaker.execute(async () => { throw new Error('fora do ar'); })).rejects.toThrow('fora do ar');
    await expect(breaker.execute(async () => 'não deve chamar')).rejects.toThrow('Circuit breaker is open');
    expect(breaker.currentState).toBe('OPEN');
  });

  it('classifica falhas externas para decidir retry e pausa', () => {
    expect(classifySourceError(Object.assign(new Error('rate limit'), { status: 429 }))).toBe('RATE_LIMITED');
    expect(classifySourceError(Object.assign(new Error('unauthorized'), { status: 401 }))).toBe('UNAUTHORIZED_CONFIGURATION');
    expect(classifySourceError(new Error('Circuit breaker is open'))).toBe('CIRCUIT_OPEN');
    expect(classifySourceError(new SyntaxError('malformed JSON'))).toBe('MALFORMED_RESPONSE');
  });

  it('mantem a pausa ate o health check confirmar recuperacao', async () => {
    const repository = new SystemStateRepository(createTestDatabase());
    repository.pauseStage('source', 'PNCP indisponivel', { source: 'PNCP' });

    expect(repository.status()).toMatchObject({ paused: true, reason: 'PNCP indisponivel' });
    expect(await repository.resumeAfterHealthCheck(() => false)).toBe(false);
    expect(repository.status().paused).toBe(true);
    expect(await repository.resumeAfterHealthCheck(() => true)).toBe(true);
    expect(repository.status().paused).toBe(false);
  });
});
