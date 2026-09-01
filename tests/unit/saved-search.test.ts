import { describe, expect, it } from 'vitest';
import { createTestDatabase } from '../../src/db/database';
import type { FilterConfig } from '../../src/domain/types';
import { OrganizationRepository } from '../../src/repositories/organizationRepository';
import { SavedSearchRepository } from '../../src/repositories/savedSearchRepository';
import { OrganizationSyncSettingsRepository } from '../../src/repositories/organizationSyncSettingsRepository';
import { NotificationRepository } from '../../src/repositories/notificationRepository';
import { completeOnboarding } from '../../src/services/onboardingService';

const filters: FilterConfig = {
  lookbackDays: 7,
  states: ['SP'],
  citiesIbge: [],
  modalities: ['6'],
  keywords: ['software'],
  excludedKeywords: [],
  minimumScore: 60,
  estimatedValueMinCents: 0,
  scoreWeights: { keyword: 60, region: 20, value: 10, deadline: 10 },
};

describe('radares salvos', () => {
  it('cria o radar inicial uma única vez e preserva seus filtros', () => {
    const db = createTestDatabase();
    const organization = new OrganizationRepository(db).create('Empresa Radar');
    const repository = new SavedSearchRepository(db);

    const first = repository.ensureDefault(organization.id, filters);
    const second = repository.ensureDefault(organization.id, { ...filters, keywords: ['obra'] });

    expect(first.id).toBe(second.id);
    expect(repository.list(organization.id)).toHaveLength(1);
    expect(second.filters.keywords).toEqual(['software']);
    expect(second.enabled).toBe(true);
  });

  it('isola radares por organização e permite pausar sem apagar', () => {
    const db = createTestDatabase();
    const organizations = new OrganizationRepository(db);
    const firstOrganization = organizations.create('Primeira Empresa');
    const secondOrganization = organizations.create('Segunda Empresa');
    const repository = new SavedSearchRepository(db);

    const first = repository.create(firstOrganization.id, 'Software SP', filters);
    repository.create(secondOrganization.id, 'Software SP', filters);
    repository.setEnabled(firstOrganization.id, first.id, false);

    expect(repository.list(firstOrganization.id)).toHaveLength(1);
    expect(repository.list(secondOrganization.id)).toHaveLength(1);
    expect(repository.listEnabled(firstOrganization.id)).toHaveLength(0);
    expect(repository.find(firstOrganization.id, first.id)?.enabled).toBe(false);
  });

  it('marca a execução e o último match do radar', () => {
    const db = createTestDatabase();
    const organization = new OrganizationRepository(db).create('Empresa Execução');
    const repository = new SavedSearchRepository(db);
    const radar = repository.create(organization.id, 'Radar principal', filters);
    const runAt = '2026-09-01T10:00:00.000Z';
    const matchAt = '2026-09-01T10:01:00.000Z';

    repository.markRun(organization.id, radar.id, runAt, matchAt);

    expect(repository.find(organization.id, radar.id)).toMatchObject({ lastRunAt: runAt, lastMatchAt: matchAt });
  });

  it('salva o primeiro perfil, canal e preferência de busca em uma operação', () => {
    const db = createTestDatabase();
    const organization = new OrganizationRepository(db).create('Empresa Onboarding');

    const result = completeOnboarding(db, organization.id, {
      radarName: 'Software para prefeituras',
      filters,
      automaticSyncEnabled: false,
      notificationsEnabled: true,
      notificationEmail: 'contato@empresa.com',
    });

    expect(result.radar.name).toBe('Software para prefeituras');
    expect(result.completedAt).toBeTruthy();
    expect(new OrganizationSyncSettingsRepository(db).isEnabled(organization.id)).toBe(false);
    expect(new NotificationRepository(db).findSettings(organization.id)).toMatchObject({ enabled: true, email: 'contato@empresa.com' });
  });
});
