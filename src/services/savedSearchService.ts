import { loadFilters } from '../config/filters';
import { findBillingPlan, type BillingPlanDefinition } from '../config/billingPlans';
import type { SqliteDatabase } from '../db/database';
import type { FilterConfig } from '../domain/types';
import { BillingService } from './billingService';
import { SavedSearchRepository, type SavedSearch } from '../repositories/savedSearchRepository';
import type { SyncMode } from './syncPolicy';

export function selectRadarsForRun<T extends { id: number; enabled: boolean }>(radars: T[], mode: SyncMode, radarId?: number): T[] {
  if (radarId !== undefined) return radars.filter((radar) => radar.id === radarId);
  return mode === 'automatic' ? radars.filter((radar) => radar.enabled) : radars;
}

export class SavedSearchService {
  private readonly repository: SavedSearchRepository;
  private readonly billing: BillingService;

  constructor(
    private readonly db: SqliteDatabase,
    private readonly plans: BillingPlanDefinition[],
    billingOptions: { trialDays: number } = { trialDays: 14 },
  ) {
    this.repository = new SavedSearchRepository(db);
    this.billing = new BillingService(db, billingOptions);
  }

  defaultFilters(): FilterConfig {
    return loadFilters();
  }

  list(organizationId: number): SavedSearch[] {
    return this.repository.list(organizationId);
  }

  limit(organizationId: number): number | null {
    const account = this.billing.account(organizationId);
    return findBillingPlan(this.plans, account?.planCode ?? 'STARTER').maxRadars;
  }

  get(organizationId: number, id: number): SavedSearch | undefined {
    return this.repository.find(organizationId, id);
  }

  create(organizationId: number, name: string, filters: FilterConfig): SavedSearch {
    const maxRadars = this.limit(organizationId);
    if (maxRadars !== null && this.repository.count(organizationId) >= maxRadars) {
      throw new Error(`Seu plano atingiu o limite de ${maxRadars} radares`);
    }
    return this.repository.create(organizationId, name, filters);
  }

  update(organizationId: number, id: number, changes: { name?: string; filters?: FilterConfig; enabled?: boolean }): SavedSearch | undefined {
    return this.repository.update(organizationId, id, changes);
  }

  remove(organizationId: number, id: number): boolean {
    return this.repository.remove(organizationId, id);
  }
}
