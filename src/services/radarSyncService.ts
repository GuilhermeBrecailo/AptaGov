import type { FilterConfig } from '../domain/types';
import type { SyncResult } from './syncService';
import { selectRadarsForRun } from './savedSearchService';
import type { SyncMode } from './syncPolicy';

export interface RadarForRun {
  id: number;
  enabled: boolean;
  filters: FilterConfig;
}

type SyncCounts = Pick<SyncResult, 'received' | 'created' | 'updated'>;

export async function runSelectedRadars<T extends RadarForRun>(
  radars: T[],
  mode: SyncMode,
  radarId: number | undefined,
  run: (radar: T) => Promise<SyncCounts>,
  markRun: (radar: T, runAt: string, lastMatchAt: string | null) => void,
): Promise<SyncCounts> {
  const selected = selectRadarsForRun(radars, mode, radarId);
  const total: SyncCounts = { received: 0, created: 0, updated: 0 };
  for (const radar of selected) {
    const runAt = new Date().toISOString();
    const result = await run(radar);
    total.received += result.received;
    total.created += result.created;
    total.updated += result.updated;
    markRun(radar, runAt, result.created > 0 ? new Date().toISOString() : null);
  }
  return total;
}
