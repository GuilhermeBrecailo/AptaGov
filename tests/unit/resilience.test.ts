import { describe, expect, it } from 'vitest';
import { CircuitBreaker } from '../../src/resilience/circuitBreaker';
import { withRetry } from '../../src/resilience/retry';

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
});
