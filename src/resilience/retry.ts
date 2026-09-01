export interface RetryOptions {
  maxRetries: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  shouldRetry?: (error: unknown) => boolean;
  sleep?: (milliseconds: number) => Promise<void>;
}

export async function withRetry<T>(operation: (attempt: number) => Promise<T>, options: RetryOptions): Promise<T> {
  const baseDelayMs = options.baseDelayMs ?? 250;
  const maxDelayMs = options.maxDelayMs ?? 10_000;
  const shouldRetry = options.shouldRetry ?? (() => true);
  const sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));

  for (let attempt = 0; ; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      if (attempt >= options.maxRetries || !shouldRetry(error)) {
        throw error;
      }
      const exponential = Math.min(maxDelayMs, baseDelayMs * (2 ** attempt));
      const jitter = Math.floor(exponential * 0.2 * Math.random());
      await sleep(exponential + jitter);
    }
  }
}

export function isRetryableError(error: unknown): boolean {
  if (error instanceof Error && error.name === 'AbortError') return true;
  if (error instanceof TypeError) return true;
  if (typeof error === 'object' && error !== null && 'status' in error) {
    const status = Number((error as { status: unknown }).status);
    return status === 408 || status === 425 || status === 429 || status >= 500;
  }
  return false;
}
