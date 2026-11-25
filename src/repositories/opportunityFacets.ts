import type { SqliteDatabase } from '../db/database';

export interface OpportunityFacets {
  modalities: string[];
  disputeModes: string[];
  cities: string[];
}

export function listOpportunityFacets(db: SqliteDatabase, state?: string): OpportunityFacets {
  const columns = (db.prepare('PRAGMA table_info(opportunities)').all() as Array<{ name: string }>).map((column) => column.name);
  return {
    modalities: distinct(db, 'modality'),
    disputeModes: columns.includes('dispute_mode') ? distinct(db, 'dispute_mode') : [],
    cities: distinct(db, 'city', state),
  };
}

// `column` is a fixed literal from this module, never user input.
function distinct(db: SqliteDatabase, column: 'modality' | 'dispute_mode' | 'city', state?: string): string[] {
  const stateClause = state ? ' AND state = ?' : '';
  const rows = db.prepare(`SELECT DISTINCT TRIM(${column}) AS value FROM opportunities WHERE ${column} IS NOT NULL AND TRIM(${column}) != ''${stateClause}`)
    .all(...(state ? [state] : [])) as Array<{ value: string }>;
  return rows.map((row) => row.value).sort((a, b) => a.localeCompare(b, 'pt-BR'));
}
