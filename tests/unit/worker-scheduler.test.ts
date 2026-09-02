import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkerScheduler } from '../../src/workerScheduler';

describe('agendamento automático do worker', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('executa ao iniciar e repete no intervalo configurado', async () => {
    vi.useFakeTimers();
    const run = vi.fn().mockResolvedValue(undefined);
    const scheduler = new WorkerScheduler({ intervalMs: 15_000, run });

    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(14_999);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(2);

    scheduler.stop();
  });

  it('não sobrepõe ciclos demorados e continua depois de uma falha', async () => {
    vi.useFakeTimers();
    let release: (() => void) | undefined;
    const run = vi.fn()
      .mockImplementationOnce(() => new Promise<void>((resolve) => { release = resolve; }))
      .mockRejectedValueOnce(new Error('PNCP indisponível'))
      .mockResolvedValue(undefined);
    const scheduler = new WorkerScheduler({ intervalMs: 10_000, run });

    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(run).toHaveBeenCalledTimes(1);

    release?.();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(run).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(run).toHaveBeenCalledTimes(3);
    scheduler.stop();
  });
  it('mantem o relogio ativo, mas ignora ciclos quando o toggle esta desligado', async () => {
    vi.useFakeTimers();
    let enabled = false;
    const run = vi.fn().mockResolvedValue(undefined);
    const scheduler = new WorkerScheduler({ intervalMs: 10_000, run, enabled: () => enabled });

    scheduler.start();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(run).toHaveBeenCalledTimes(0);

    enabled = true;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(run).toHaveBeenCalledTimes(1);
    scheduler.stop();
  });
});
