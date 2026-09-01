import { describe, expect, it } from 'vitest';
import { defaultBillingPlans } from '../../src/config/billingPlans';
import { createTestDatabase } from '../../src/db/database';
import { OrganizationRepository } from '../../src/repositories/organizationRepository';
import { SavedSearchRepository } from '../../src/repositories/savedSearchRepository';
import { SavedSearchService, selectRadarsForNotifications, selectRadarsForRun } from '../../src/services/savedSearchService';
import { runSelectedRadars } from '../../src/services/radarSyncService';

describe('limite de radares por plano', () => {
  it('usa limites comerciais do plano e bloqueia o próximo radar', () => {
    const db = createTestDatabase();
    const organization = new OrganizationRepository(db).create('Empresa Limite');
    const service = new SavedSearchService(db, defaultBillingPlans, { trialDays: 14 });
    const filters = service.defaultFilters();

    service.create(organization.id, 'Radar 1', filters);
    service.create(organization.id, 'Radar 2', filters);
    service.create(organization.id, 'Radar 3', filters);

    expect(() => service.create(organization.id, 'Radar 4', filters)).toThrow('limite de 3 radares');
    expect(new SavedSearchRepository(db).count(organization.id)).toBe(3);
  });

  it('usa apenas radares ativos no automático e aceita um radar pausado no manual', () => {
    const radars = [
      { id: 1, enabled: true },
      { id: 2, enabled: false },
      { id: 3, enabled: true },
    ];

    expect(selectRadarsForRun(radars, 'automatic').map((radar) => radar.id)).toEqual([1, 3]);
    expect(selectRadarsForRun(radars, 'manual', 2).map((radar) => radar.id)).toEqual([2]);
  });

  it('separa a busca automática dos alertas de cada radar', () => {
    const radars = [
      { id: 1, enabled: true, notificationsEnabled: true },
      { id: 2, enabled: true, notificationsEnabled: false },
      { id: 3, enabled: false, notificationsEnabled: true },
    ];

    expect(selectRadarsForNotifications(radars, 'automatic').map((radar) => radar.id)).toEqual([1]);
    expect(selectRadarsForNotifications(radars, 'manual').map((radar) => radar.id)).toEqual([1, 3]);
  });

  it('executa os radares selecionados e atualiza a última execução', async () => {
    const radarFilters = {
      lookbackDays: 7,
      states: [],
      citiesIbge: [],
      modalities: ['6'],
      keywords: [],
      excludedKeywords: [],
      minimumScore: 0,
      estimatedValueMinCents: 0,
      scoreWeights: { keyword: 50, region: 20, value: 10, deadline: 20 },
    };
    const radars = [
      { id: 1, enabled: true, filters: radarFilters },
      { id: 2, enabled: false, filters: radarFilters },
    ];
    const runs: number[] = [];
    const marks: Array<[number, string | null]> = [];

    const result = await runSelectedRadars(radars, 'automatic', undefined, async (radar) => {
      runs.push(radar.id);
      return { received: 3, created: 2, updated: 1 };
    }, (_radar, _runAt, lastMatchAt) => marks.push([_radar.id, lastMatchAt]));

    expect(result).toEqual({ received: 3, created: 2, updated: 1 });
    expect(runs).toEqual([1]);
    expect(marks).toHaveLength(1);
    expect(marks[0]?.[1]).toBeTruthy();
  });
});
