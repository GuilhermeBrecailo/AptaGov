import type { SqliteDatabase } from '../db/database';

export type JobStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';
export interface JobRecord {
  id: number;
  type: string;
  status: JobStatus;
  checkpoint: Record<string, unknown>;
  errorMessage: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  key: string | null;
}

export interface JobRow {
  id: number;
  type: string;
  status: JobStatus;
  checkpoint_json: string;
  error_message: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
}

export class JobRepository {
  constructor(private readonly db: SqliteDatabase) {}

  create(type: string, checkpoint: Record<string, unknown> = {}, key?: string): number {
    if (key) {
      const existing = this.list().find((job) => job.type === type
        && job.key === key
        && (job.status === 'PENDING' || job.status === 'RUNNING'));
      if (existing) return existing.id;
    }
    const payload = key ? { ...checkpoint, jobKey: key } : checkpoint;
    const result = this.db.prepare('INSERT INTO job_runs (type, checkpoint_json, created_at) VALUES (?, ?, ?)')
      .run(type, JSON.stringify(payload), new Date().toISOString());
    return Number(result.lastInsertRowid);
  }

  markRunning(id: number): void {
    this.db.prepare("UPDATE job_runs SET status = 'RUNNING', started_at = ? WHERE id = ?").run(new Date().toISOString(), id);
  }

  claim(id: number): boolean {
    const result = this.db.prepare("UPDATE job_runs SET status = 'RUNNING', started_at = ? WHERE id = ? AND status = 'PENDING'")
      .run(new Date().toISOString(), id);
    return result.changes > 0;
  }

  markCompleted(id: number): void {
    this.db.prepare("UPDATE job_runs SET status = 'COMPLETED', finished_at = ? WHERE id = ?").run(new Date().toISOString(), id);
  }

  markFailed(id: number, error: string): void {
    this.db.prepare("UPDATE job_runs SET status = 'FAILED', error_message = ?, finished_at = ? WHERE id = ?")
      .run(error.slice(0, 500), new Date().toISOString(), id);
  }

  updateCheckpoint(id: number, checkpoint: Record<string, unknown>): void {
    const current = this.find(id);
    if (!current) return;
    const next = { ...current.checkpoint, ...checkpoint };
    this.db.prepare('UPDATE job_runs SET checkpoint_json = ? WHERE id = ?').run(JSON.stringify(next), id);
  }

  recoverInterrupted(): JobRecord[] {
    const interrupted = this.db.prepare("SELECT * FROM job_runs WHERE status = 'RUNNING' ORDER BY id ASC").all() as JobRow[];
    if (interrupted.length > 0) {
      this.db.prepare("UPDATE job_runs SET status = 'PENDING', started_at = NULL WHERE status = 'RUNNING'").run();
    }
    return interrupted.map((row) => mapRow({ ...row, status: 'PENDING' }));
  }

  list(status?: JobStatus): JobRecord[] {
    const rows = status
      ? this.db.prepare('SELECT * FROM job_runs WHERE status = ? ORDER BY id ASC').all(status) as JobRow[]
      : this.db.prepare('SELECT * FROM job_runs ORDER BY id ASC').all() as JobRow[];
    return rows.map(mapRow);
  }

  find(id: number): JobRecord | undefined {
    const row = this.db.prepare('SELECT * FROM job_runs WHERE id = ?').get(id) as JobRow | undefined;
    return row ? mapRow(row) : undefined;
  }
}

function mapRow(row: JobRow): JobRecord {
  const parsed = parseCheckpoint(row.checkpoint_json);
  return {
    id: row.id,
    type: row.type,
    status: row.status,
    checkpoint: parsed,
    errorMessage: row.error_message,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    createdAt: row.created_at,
    key: typeof parsed.jobKey === 'string' ? parsed.jobKey : null,
  };
}

function parseCheckpoint(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}
