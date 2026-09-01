import type { SqliteDatabase } from '../db/database';

export class NotificationBudgetRepository {
  constructor(private readonly db: SqliteDatabase) {}

  countCreatedSince(since: string): number {
    const row = this.db.prepare(`
      SELECT COUNT(*) AS count
      FROM (
        SELECT id FROM notification_deliveries WHERE created_at >= ?
        UNION ALL
        SELECT id FROM push_deliveries WHERE created_at >= ?
      )
    `).get(since, since) as { count: number };
    return row.count;
  }
}
