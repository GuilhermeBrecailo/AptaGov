import type { SqliteDatabase } from '../db/database';
import type { FilterConfig } from '../domain/types';

export class OrganizationFilterRepository {
  constructor(private readonly db: SqliteDatabase) {}

  find(organizationId: number): FilterConfig | undefined {
    const row = this.db.prepare('SELECT filters_json FROM organization_filters WHERE organization_id = ?').get(organizationId) as { filters_json: string } | undefined;
    return row ? JSON.parse(row.filters_json) as FilterConfig : undefined;
  }

  save(organizationId: number, filters: FilterConfig): FilterConfig {
    this.db.prepare(`
      INSERT INTO organization_filters (organization_id, filters_json, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(organization_id) DO UPDATE SET filters_json = excluded.filters_json, updated_at = excluded.updated_at
    `).run(organizationId, JSON.stringify(filters), new Date().toISOString());
    return filters;
  }
}
