import type { SqliteDatabase } from '../../db/database';
import { parsePncpId } from '../edital/pncpDocuments';
import type { PncpDetailClient, PncpFileView, PncpItem } from './pncpDetailClient';

export const DETAIL_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

export type OpportunityDetailPncp = {
  source: 'pncp' | 'platform-only';
  items: PncpItem[];
  itemsTotal: number;
  truncated: boolean;
  files: PncpFileView[];
  fetchedAt: string | null;
  stale: boolean;
  unavailable: boolean;
};

type CacheRow = { items_json: string; files_json: string; items_total: number; truncated: number; fetched_at: string };

const EMPTY: OpportunityDetailPncp = {
  source: 'pncp', items: [], itemsTotal: 0, truncated: false, files: [], fetchedAt: null, stale: false, unavailable: false
};

export class OpportunityDetailService {
  private readonly db: SqliteDatabase;
  private readonly client: Pick<PncpDetailClient, 'listItems' | 'listFiles'>;
  private readonly now: () => Date;

  constructor(options: { db: SqliteDatabase; client: Pick<PncpDetailClient, 'listItems' | 'listFiles'>; now?: () => Date }) {
    this.db = options.db;
    this.client = options.client;
    this.now = options.now ?? (() => new Date());
  }

  async get(opportunityId: number): Promise<OpportunityDetailPncp> {
    const opportunity = this.db.prepare('SELECT pncp_id FROM opportunities WHERE id = ?').get(opportunityId) as { pncp_id: string } | undefined;
    if (!opportunity) throw new Error('Oportunidade não encontrada.');
    const parsed = parsePncpId(opportunity.pncp_id);
    if (!parsed) return { ...EMPTY, source: 'platform-only' };

    const row = this.db.prepare('SELECT items_json, files_json, items_total, truncated, fetched_at FROM opportunity_detail_cache WHERE opportunity_id = ?')
      .get(opportunityId) as CacheRow | undefined;
    // A corrupt row is treated as no cache.
    const cached = row ? fromCache(row) : null;
    if (cached?.fetchedAt && this.now().getTime() - Date.parse(cached.fetchedAt) < DETAIL_CACHE_TTL_MS) return cached;

    try {
      const [{ items, total, truncated }, files] = await Promise.all([this.client.listItems(parsed), this.client.listFiles(opportunity.pncp_id)]);
      const fetchedAt = this.now().toISOString();
      this.db.prepare(`
        INSERT INTO opportunity_detail_cache (opportunity_id, items_json, files_json, items_total, truncated, fetched_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(opportunity_id) DO UPDATE SET items_json = excluded.items_json, files_json = excluded.files_json,
          items_total = excluded.items_total, truncated = excluded.truncated, fetched_at = excluded.fetched_at
      `).run(opportunityId, JSON.stringify(items), JSON.stringify(files), total, truncated ? 1 : 0, fetchedAt);
      return { source: 'pncp', items, itemsTotal: total, truncated, files, fetchedAt, stale: false, unavailable: false };
    } catch {
      return cached ? { ...cached, stale: true } : { ...EMPTY, unavailable: true };
    }
  }
}

function fromCache(row: CacheRow): OpportunityDetailPncp | null {
  try {
    const items: unknown = JSON.parse(row.items_json);
    const files: unknown = JSON.parse(row.files_json);
    if (!Array.isArray(items) || !Array.isArray(files)) return null;
    return {
      source: 'pncp',
      items: items as PncpItem[],
      itemsTotal: row.items_total,
      truncated: row.truncated === 1,
      files: files as PncpFileView[],
      fetchedAt: row.fetched_at,
      stale: false,
      unavailable: false
    };
  } catch {
    return null;
  }
}
