import type { SqliteDatabase } from '../db/database';
import { filterConfigSchema } from '../config/filters';
import type { FilterConfig } from '../domain/types';

export interface SavedSearch {
  id: number;
  organizationId: number;
  name: string;
  filters: FilterConfig;
  enabled: boolean;
  lastRunAt: string | null;
  lastMatchAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export class SavedSearchRepository {
  constructor(private readonly db: SqliteDatabase) {}

  list(organizationId: number): SavedSearch[] {
    const rows = this.db.prepare('SELECT * FROM saved_searches WHERE organization_id = ? ORDER BY enabled DESC, updated_at DESC, id DESC')
      .all(organizationId) as SavedSearchRow[];
    return rows.map(mapRow);
  }

  listEnabled(organizationId: number): SavedSearch[] {
    const rows = this.db.prepare('SELECT * FROM saved_searches WHERE organization_id = ? AND enabled = 1 ORDER BY id ASC')
      .all(organizationId) as SavedSearchRow[];
    return rows.map(mapRow);
  }

  count(organizationId: number): number {
    return (this.db.prepare('SELECT COUNT(*) AS count FROM saved_searches WHERE organization_id = ?').get(organizationId) as { count: number }).count;
  }

  find(organizationId: number, id: number): SavedSearch | undefined {
    const row = this.db.prepare('SELECT * FROM saved_searches WHERE organization_id = ? AND id = ?').get(organizationId, id) as SavedSearchRow | undefined;
    return row ? mapRow(row) : undefined;
  }

  findByName(organizationId: number, name: string): SavedSearch | undefined {
    const row = this.db.prepare('SELECT * FROM saved_searches WHERE organization_id = ? AND name = ?').get(organizationId, name.trim()) as SavedSearchRow | undefined;
    return row ? mapRow(row) : undefined;
  }

  create(organizationId: number, name: string, filters: FilterConfig): SavedSearch {
    const normalizedName = normalizeName(name);
    const validFilters = filterConfigSchema.parse(filters);
    const now = new Date().toISOString();
    const result = this.db.prepare(`
      INSERT INTO saved_searches (organization_id, name, filters_json, enabled, created_at, updated_at)
      VALUES (?, ?, ?, 1, ?, ?)
    `).run(organizationId, normalizedName, JSON.stringify(validFilters), now, now);
    return this.find(organizationId, Number(result.lastInsertRowid)) as SavedSearch;
  }

  ensureDefault(organizationId: number, filters: FilterConfig): SavedSearch {
    const name = 'Radar principal';
    const existing = this.findByName(organizationId, name);
    if (existing) return existing;
    const validFilters = filterConfigSchema.parse(filters);
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO saved_searches (organization_id, name, filters_json, enabled, created_at, updated_at)
      VALUES (?, ?, ?, 1, ?, ?)
      ON CONFLICT(organization_id, name) DO NOTHING
    `).run(organizationId, name, JSON.stringify(validFilters), now, now);
    return this.findByName(organizationId, name) as SavedSearch;
  }

  update(organizationId: number, id: number, changes: { name?: string; filters?: FilterConfig; enabled?: boolean }): SavedSearch | undefined {
    const current = this.find(organizationId, id);
    if (!current) return undefined;
    const name = changes.name === undefined ? current.name : normalizeName(changes.name);
    const filters = changes.filters === undefined ? current.filters : filterConfigSchema.parse(changes.filters);
    const enabled = changes.enabled === undefined ? current.enabled : changes.enabled;
    this.db.prepare(`
      UPDATE saved_searches
      SET name = ?, filters_json = ?, enabled = ?, updated_at = ?
      WHERE organization_id = ? AND id = ?
    `).run(name, JSON.stringify(filters), enabled ? 1 : 0, new Date().toISOString(), organizationId, id);
    return this.find(organizationId, id);
  }

  setEnabled(organizationId: number, id: number, enabled: boolean): SavedSearch | undefined {
    return this.update(organizationId, id, { enabled });
  }

  remove(organizationId: number, id: number): boolean {
    return this.db.prepare('DELETE FROM saved_searches WHERE organization_id = ? AND id = ?').run(organizationId, id).changes > 0;
  }

  markRun(organizationId: number, id: number, lastRunAt: string, lastMatchAt: string | null): void {
    this.db.prepare('UPDATE saved_searches SET last_run_at = ?, last_match_at = ?, updated_at = ? WHERE organization_id = ? AND id = ?')
      .run(lastRunAt, lastMatchAt, new Date().toISOString(), organizationId, id);
  }
}

type SavedSearchRow = {
  id: number;
  organization_id: number;
  name: string;
  filters_json: string;
  enabled: number;
  last_run_at: string | null;
  last_match_at: string | null;
  created_at: string;
  updated_at: string;
};

function mapRow(row: SavedSearchRow): SavedSearch {
  return {
    id: row.id,
    organizationId: row.organization_id,
    name: row.name,
    filters: filterConfigSchema.parse(JSON.parse(row.filters_json)),
    enabled: row.enabled === 1,
    lastRunAt: row.last_run_at,
    lastMatchAt: row.last_match_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizeName(value: string): string {
  const name = value.trim();
  if (name.length < 2) throw new Error('Dê um nome para o radar');
  if (name.length > 80) throw new Error('O nome do radar deve ter no máximo 80 caracteres');
  return name;
}
