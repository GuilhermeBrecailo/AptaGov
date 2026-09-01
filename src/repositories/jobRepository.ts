import type { SqliteDatabase } from '../db/database';

export type JobStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';
export interface JobRecord { id: number; type: string; status: JobStatus; }

export class JobRepository {
  constructor(private readonly db: SqliteDatabase) {}

  create(type: string): number {
    const result = this.db.prepare('INSERT INTO job_runs (type, created_at) VALUES (?, ?)').run(type, new Date().toISOString());
    return Number(result.lastInsertRowid);
  }

  markRunning(id: number): void {
    this.db.prepare("UPDATE job_runs SET status = 'RUNNING', started_at = ? WHERE id = ?").run(new Date().toISOString(), id);
  }

  markCompleted(id: number): void {
    this.db.prepare("UPDATE job_runs SET status = 'COMPLETED', finished_at = ? WHERE id = ?").run(new Date().toISOString(), id);
  }

  markFailed(id: number, error: string): void {
    this.db.prepare("UPDATE job_runs SET status = 'FAILED', error_message = ?, finished_at = ? WHERE id = ?")
      .run(error.slice(0, 500), new Date().toISOString(), id);
  }

  recoverInterrupted(): void {
    this.db.prepare("UPDATE job_runs SET status = 'PENDING', started_at = NULL WHERE status = 'RUNNING'").run();
  }

  find(id: number): JobRecord | undefined {
    return this.db.prepare('SELECT id, type, status FROM job_runs WHERE id = ?').get(id) as JobRecord | undefined;
  }
}
