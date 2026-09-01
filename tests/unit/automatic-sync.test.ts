import { describe, expect, it } from 'vitest';
import { createTestDatabase } from '../../src/db/database';
import { OrganizationRepository } from '../../src/repositories/organizationRepository';
import { OrganizationSyncSettingsRepository } from '../../src/repositories/organizationSyncSettingsRepository';
import { loadEnv } from '../../src/config/env';
import { shouldRunSync } from '../../src/services/syncPolicy';

describe('busca automatica por organizacao', () => {
  it('fica habilitada por padrao e persiste a preferencia da organizacao', () => {
    const db = createTestDatabase();
    const organizations = new OrganizationRepository(db);
    const first = organizations.create('Empresa A');
    const second = organizations.create('Empresa B');
    const settings = new OrganizationSyncSettingsRepository(db);

    expect(settings.isEnabled(first.id)).toBe(true);
    expect(settings.isEnabled(second.id)).toBe(true);

    settings.save(first.id, false);

    expect(settings.isEnabled(first.id)).toBe(false);
    expect(settings.isEnabled(second.id)).toBe(true);
    expect(settings.listEnabledOrganizationIds()).toEqual([second.id]);
    db.close();
  });

  it('permite sincronizacao manual mesmo com busca automatica desabilitada', () => {
    expect(shouldRunSync('automatic', false)).toBe(false);
    expect(shouldRunSync('automatic', true)).toBe(true);
    expect(shouldRunSync('manual', false)).toBe(true);
  });

  it('usa dez minutos como intervalo automatico padrao', () => {
    expect(loadEnv({ NODE_ENV: 'test' }).syncIntervalMinutes).toBe(10);
  });
});
