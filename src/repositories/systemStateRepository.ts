import type { SqliteDatabase } from '../db/database';

export interface SystemPause {
  paused: boolean;
  global?: boolean;
  reason: string | null;
  details?: Record<string, unknown>;
  pauses?: SystemPauseEntry[];
}

export interface SystemPauseEntry {
  stage: WorkerStage;
  source?: string;
  channel?: string;
  reason: string;
  details: Record<string, unknown>;
  pausedAt: string;
  updatedAt: string;
}

export interface PauseSelector {
  stage?: WorkerStage;
  source?: string;
  channel?: string;
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
    const source = stringDetail(details.source);
    const channel = stringDetail(details.channel);
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO worker_pauses (stage, source, channel, reason, details_json, paused_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(stage, source, channel) DO UPDATE SET
        reason = excluded.reason, details_json = excluded.details_json, updated_at = excluded.updated_at
    `).run(stage, source ?? '', channel ?? '', reason, JSON.stringify(details), now, now);
  }

  isStagePaused(stage: WorkerStage, selector: Omit<PauseSelector, 'stage'> = {}): boolean {
    if (this.isGloballyPaused()) return true;
    return this.listPauses().some((pause) => pause.stage === stage
      && (!pause.source || pause.source === selector.source)
      && (!pause.channel || pause.channel === selector.channel));
  }

  async resumeAfterHealthCheck(healthCheck: () => boolean | Promise<boolean>): Promise<boolean> {
    if (!(await healthCheck())) return false;
    this.resume();
    return true;
  }

  resume(selector?: PauseSelector): void {
    if (!selector || (!selector.stage && !selector.source && !selector.channel)) {
      this.db.prepare("DELETE FROM system_state WHERE key = 'worker_pause'").run();
      this.db.prepare('DELETE FROM worker_pauses').run();
      return;
    }
    if (selector.stage === 'worker' && selector.source === undefined && selector.channel === undefined) {
      this.db.prepare("DELETE FROM system_state WHERE key = 'worker_pause'").run();
      this.db.prepare("DELETE FROM worker_pauses WHERE stage = 'worker' AND source = '' AND channel = ''").run();
      return;
    }
    const conditions: string[] = [];
    const params: Array<string> = [];
    if (selector.stage) { conditions.push('stage = ?'); params.push(selector.stage); }
    if (selector.source !== undefined) {
      conditions.push('source = ?');
      params.push(selector.source);
    }
    if (selector.channel !== undefined) {
      conditions.push('channel = ?');
      params.push(selector.channel);
    }
    this.db.prepare(`DELETE FROM worker_pauses WHERE ${conditions.join(' AND ')}`).run(...params);
  }

  status(): SystemPause {
    const row = this.db.prepare("SELECT value FROM system_state WHERE key = 'worker_pause'").get() as { value: string } | undefined;
    const pauses = this.listPauses();
    const globalPause = pauses.find((pause) => pause.stage === 'worker' && !pause.source && !pause.channel);
    if (!row && pauses.length === 0) return { paused: false, global: false, reason: null };
    if (row) {
      const legacy = JSON.parse(row.value) as SystemPause;
      return { ...legacy, paused: true, global: true, pauses };
    }
    if (globalPause) {
      return {
        paused: true,
        global: true,
        reason: globalPause.reason,
        details: { ...globalPause.details, stage: 'worker' },
        pauses,
      };
    }
    const latest = pauses[pauses.length - 1]!;
    return {
      paused: true,
      global: false,
      reason: latest.reason,
      details: { ...latest.details, stage: latest.stage, ...(latest.source ? { source: latest.source } : {}), ...(latest.channel ? { channel: latest.channel } : {}) },
      pauses,
    };
  }

  listPauses(): SystemPauseEntry[] {
    const rows = this.db.prepare('SELECT * FROM worker_pauses ORDER BY updated_at ASC, stage ASC, source ASC, channel ASC').all() as PauseRow[];
    return rows.map((row) => ({
      stage: row.stage,
      source: row.source || undefined,
      channel: row.channel || undefined,
      reason: row.reason,
      details: parseDetails(row.details_json),
      pausedAt: row.paused_at,
      updatedAt: row.updated_at,
    }));
  }

  private isGloballyPaused(): boolean {
    return Boolean(this.db.prepare("SELECT 1 FROM system_state WHERE key = 'worker_pause'").get())
      || Boolean(this.db.prepare("SELECT 1 FROM worker_pauses WHERE stage = 'worker' AND source = '' AND channel = ''").get());
  }
}

interface PauseRow {
  stage: WorkerStage;
  source: string;
  channel: string;
  reason: string;
  details_json: string;
  paused_at: string;
  updated_at: string;
}

function stringDetail(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function parseDetails(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}
