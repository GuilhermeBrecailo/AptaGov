export interface WorkerSchedulerOptions {
  intervalMs: number;
  run: () => Promise<unknown>;
  onError?: (error: unknown) => void;
}

export class WorkerScheduler {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private started = false;
  private running = false;

  constructor(private readonly options: WorkerSchedulerOptions) {}

  start(): void {
    if (this.started) return;
    this.started = true;
    this.schedule(0);
  }

  stop(): void {
    this.started = false;
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  private schedule(delayMs: number): void {
    if (!this.started) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.tick();
    }, delayMs);
  }

  private async tick(): Promise<void> {
    if (!this.started || this.running) return;
    this.running = true;
    try {
      await this.options.run();
    } catch (error) {
      this.options.onError?.(error);
    } finally {
      this.running = false;
      this.schedule(this.options.intervalMs);
    }
  }
}
