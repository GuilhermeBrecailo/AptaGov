import type { SqliteDatabase } from '../db/database';
import { filterConfigSchema } from '../config/filters';
import type { FilterConfig } from '../domain/types';
import { NotificationRepository } from '../repositories/notificationRepository';
import { OrganizationFilterRepository } from '../repositories/organizationFilterRepository';
import { OrganizationRepository } from '../repositories/organizationRepository';
import { OrganizationSyncSettingsRepository } from '../repositories/organizationSyncSettingsRepository';
import { SavedSearchRepository, type SavedSearch } from '../repositories/savedSearchRepository';

export interface OnboardingInput {
  radarName: string;
  filters: FilterConfig;
  automaticSyncEnabled: boolean;
  notificationsEnabled: boolean;
  notificationEmail: string;
}

export interface OnboardingResult {
  radar: SavedSearch;
  completedAt: string;
}

export function completeOnboarding(db: SqliteDatabase, organizationId: number, input: OnboardingInput): OnboardingResult {
  const filters = filterConfigSchema.parse(input.filters);
  const email = input.notificationEmail.trim().toLowerCase();
  if (input.notificationsEnabled && !/^\S+@\S+\.\S+$/.test(email)) {
    throw new Error('Informe um e-mail válido para receber alertas');
  }

  return db.transaction(() => {
    const savedFilters = new OrganizationFilterRepository(db).save(organizationId, filters);
    const radars = new SavedSearchRepository(db);
    const existing = radars.findByName(organizationId, input.radarName.trim());
    const radar = existing
      ? radars.update(organizationId, existing.id, { filters: savedFilters, enabled: true }) as SavedSearch
      : radars.create(organizationId, input.radarName, savedFilters);
    new OrganizationSyncSettingsRepository(db).save(organizationId, input.automaticSyncEnabled);
    new NotificationRepository(db).saveSettings(organizationId, { enabled: input.notificationsEnabled, email });
    const completedAt = new Date().toISOString();
    new OrganizationRepository(db).markOnboardingCompleted(organizationId, completedAt);
    return { radar, completedAt };
  })();
}

