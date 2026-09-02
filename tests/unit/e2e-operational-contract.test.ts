import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveOperationalE2EConfig, type OperationalE2EChannels } from '../../scripts/e2e-operational-real';

const projectRoot = resolve(import.meta.dirname, '../..');

const configuredChannels: OperationalE2EChannels = {
  resendApiKey: 'configured-secret',
  notificationEmailFrom: 'AptaGov <notifications@example.com>',
  vapidSubject: 'mailto:admin@example.com',
  vapidPublicKey: 'configured-public-key',
  vapidPrivateKey: 'configured-private-key',
};

describe('operational real E2E contract', () => {
  it('blocks notification delivery and uses a temporary database by default', () => {
    const config = resolveOperationalE2EConfig({}, './data/production.db', './data/e2e-operational.db', configuredChannels);

    expect(config.databaseUrl).toBe('./data/e2e-operational.db');
    expect(config.allowNotificationDelivery).toBe(false);
    expect(config.channels).toEqual({
      resendApiKey: '',
      notificationEmailFrom: '',
      vapidSubject: '',
      vapidPublicKey: '',
      vapidPrivateKey: '',
    });
  });

  it('requires explicit authorization before using a provided existing database', () => {
    expect(() => resolveOperationalE2EConfig(
      { E2E_DATABASE_URL: './data/production.db' },
      './data/production.db',
      './data/e2e-operational.db',
      configuredChannels,
    )).toThrow(/E2E_ALLOW_EXISTING_DATABASE/);
  });

  it('only enables real delivery with both the flag and an explicit recipient', () => {
    const config = resolveOperationalE2EConfig({
      E2E_ALLOW_NOTIFICATION_DELIVERY: 'true',
      E2E_NOTIFICATION_EMAIL: 'qa@example.com',
    }, './data/production.db', './data/e2e-operational.db', configuredChannels);

    expect(config.allowNotificationDelivery).toBe(true);
    expect(config.notificationEmail).toBe('qa@example.com');
    expect(config.channels).toEqual(configuredChannels);
  });

  it('registers the operational runner command', () => {
    const packageJson = JSON.parse(readFileSync(resolve(projectRoot, 'package.json'), 'utf8')) as {
      scripts?: Record<string, string>;
    };

    expect(packageJson.scripts?.['e2e:operational-real']).toBe('tsx scripts/e2e-operational-real.ts');
  });
});
