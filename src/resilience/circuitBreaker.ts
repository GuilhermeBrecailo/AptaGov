export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export class CircuitBreaker {
  private state: CircuitState = 'CLOSED';
  private failures = 0;
  private openedAt = 0;

  constructor(private readonly failureThreshold = 3, private readonly resetTimeoutMs = 30_000) {}

  get currentState(): CircuitState {
    if (this.state === 'OPEN' && Date.now() - this.openedAt >= this.resetTimeoutMs) {
      this.state = 'HALF_OPEN';
    }
    return this.state;
  }

  async execute<T>(operation: () => Promise<T>): Promise<T> {
    if (this.currentState === 'OPEN') {
      throw new Error('Circuit breaker is open');
    }
    try {
      const result = await operation();
      this.failures = 0;
      this.state = 'CLOSED';
      return result;
    } catch (error) {
      this.failures += 1;
      if (this.failures >= this.failureThreshold) {
        this.state = 'OPEN';
        this.openedAt = Date.now();
      }
      throw error;
    }
  }
}
