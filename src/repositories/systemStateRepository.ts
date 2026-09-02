import type { SqliteDatabase } from '../db/database';

export interface SystemPause {
  paused: boolean;
  reason: string | null;
  details?: Record<string, unknown>;
}

export type WorkerStage = 'source' | 'agenda' | 'market' | 'notifications' | 'backup' | 'worker';

export class SystemStateRepository {
  constructor(private readonly db: SqliteDatabase) {}

  pause(reason: string, details: Record<string, unknown> = {}): void {
    this.db.prepare(`
      INSERT INTO system_state (key, value, updated_at) VALUES ('worker_pause', ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run(JSON.stringify({ paused: true, reason, details }), new Date().toISOString());
  }

  pauseStage(stage: WorkerStage, reason: string, details: Record<string, unknown> = {}): void {
    this.pause(reason, { ...details, stage });
  }

  isStagePaused(stage: WorkerStage): boolean {
    const current = this.status();
    if (!current.paused) return false;
    const pausedStage = current.details?.stage;
    return typeof pausedStage !== 'string' || pausedStage === stage;
  }

  async resumeAfterHealthCheck(healthCheck: () => boolean | Promise<boolean>): Promise<boolean> {
    if (!(await healthCheck())) return false;
    this.resume();
    return true;
  }

  resume(): void {
    this.db.prepare("DELETE FROM system_state WHERE key = 'worker_pause'").run();
  }

  status(): SystemPause {
    const row = this.db.prepare("SELECT value FROM system_state WHERE key = 'worker_pause'").get() as { value: string } | undefined;
    if (!row) return { paused: false, reason: null };
    return JSON.parse(row.value) as SystemPause;
  }
}
