import type { SqliteDatabase } from '../db/database';

export interface PersistedWorkerMetrics<T = unknown> {
  id: number;
  mode: 'automatic' | 'manual';
  startedAt: string;
  finishedAt: string;
  paused: boolean;
  metrics: T;
  createdAt: string;
}

export class WorkerMetricsRepository {
  constructor(private readonly db: SqliteDatabase) {}

  save(mode: 'automatic' | 'manual', metrics: unknown, paused: boolean): number {
    const value = metrics as { startedAt?: unknown; finishedAt?: unknown };
    const startedAt = typeof value.startedAt === 'string' ? value.startedAt : new Date().toISOString();
    const finishedAt = typeof value.finishedAt === 'string' ? value.finishedAt : startedAt;
    const now = new Date().toISOString();
    const result = this.db.prepare(`
      INSERT INTO worker_cycle_metrics (mode, started_at, finished_at, paused, metrics_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(mode, startedAt, finishedAt, paused ? 1 : 0, JSON.stringify(metrics), now);
    return Number(result.lastInsertRowid);
  }

  latest<T = unknown>(): PersistedWorkerMetrics<T> | undefined {
    const row = this.db.prepare('SELECT * FROM worker_cycle_metrics ORDER BY finished_at DESC, id DESC LIMIT 1').get() as WorkerMetricsRow | undefined;
    return row ? mapRow<T>(row) : undefined;
  }

  list<T = unknown>(limit = 20): PersistedWorkerMetrics<T>[] {
    const rows = this.db.prepare('SELECT * FROM worker_cycle_metrics ORDER BY finished_at DESC, id DESC LIMIT ?').all(Math.max(1, Math.floor(limit))) as WorkerMetricsRow[];
    return rows.map((row) => mapRow<T>(row));
  }
}

interface WorkerMetricsRow {
  id: number;
  mode: 'automatic' | 'manual';
  started_at: string;
  finished_at: string;
  paused: number;
  metrics_json: string;
  created_at: string;
}

function mapRow<T>(row: WorkerMetricsRow): PersistedWorkerMetrics<T> {
  return {
    id: row.id,
    mode: row.mode,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    paused: row.paused === 1,
    metrics: parse(row.metrics_json) as T,
    createdAt: row.created_at,
  };
}

function parse(value: string): unknown {
  try { return JSON.parse(value) as unknown; } catch { return {}; }
}
