import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { loadEnv } from '../../src/config/env';
import { loadFilters } from '../../src/config/filters';

const root = resolve('C:/Users/user/Documents/dev/licitacoes-pncp');

describe('configuração e segurança operacional', () => {
  it('preserva o contrato OPENAI e mantém a IA desligada por padrão', () => {
    const env = loadEnv({
      NODE_ENV: 'test',
      DATABASE_URL: ':memory:',
      OPENAI_API_KEY: 'sk-test-key',
      OPENAI_MODEL_FAST: 'gpt-test-fast',
      OPENAI_MONTHLY_BUDGET_USD: '25',
      AI_ENABLED: 'false',
    }) as unknown as Record<string, unknown>;

    expect(env.openAiApiKey).toBe('sk-test-key');
    expect(env.openAiModelFast).toBe('gpt-test-fast');
    expect(env.openAiMonthlyBudgetUsd).toBe(25);
    expect(env.aiEnabled).toBe(false);
  });

  it('documenta as credenciais e os parâmetros operacionais no exemplo de ambiente', () => {
    const example = readFileSync(join(root, '.env.example'), 'utf8');

    for (const key of [
      'DATABASE_URL',
      'SYNC_INTERVAL_MINUTES',
      'PNCP_TIMEOUT_MS',
      'PNCP_MAX_RETRIES',
      'MAX_NOTIFICATIONS_PER_HOUR',
      'OPENAI_API_KEY',
      'OPENAI_MODEL_FAST',
      'OPENAI_MONTHLY_BUDGET_USD',
      'RESEND_API_KEY',
      'VAPID_SUBJECT',
      'VAPID_PUBLIC_KEY',
      'VAPID_PRIVATE_KEY',
      'BEC_SP_ENABLED',
      'BEC_SP_BASE_URL',
      'BEC_SP_TIMEOUT_MS',
      'BEC_SP_MAX_RETRIES',
      'MARKET_MIN_OBSERVATIONS',
      'MARKET_LOOKBACK_DAYS',
    ]) {
      expect(example).toContain(`${key}=`);
    }
    expect(example).toContain('AI_ENABLED=false');
  });

  it('ignora explicitamente todos os artefatos operacionais locais', () => {
    const gitignore = readFileSync(join(root, '.gitignore'), 'utf8');

    for (const entry of ['.env', 'config/filters.json', '*.db', 'data/', 'backups/']) {
      expect(gitignore.split(/\r?\n/)).toContain(entry);
    }
  });

  it('cria os filtros locais a partir do exemplo somente quando o arquivo não existe', () => {
    const directory = mkdtempSync(join(tmpdir(), 'aptagov-filters-'));
    const target = join(directory, 'config', 'filters.json');

    try {
      const filters = loadFilters(target);
      expect(existsSync(target)).toBe(true);
      expect(filters.scoreWeights).toEqual({ keyword: 50, region: 20, value: 10, deadline: 20 });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('mantém o exemplo de filtros completo e com tipos seguros para uso local', () => {
    const example = JSON.parse(readFileSync(join(root, 'config/filters.example.json'), 'utf8')) as Record<string, unknown>;

    expect(Object.keys(example)).toEqual(expect.arrayContaining([
      'lookbackDays',
      'states',
      'citiesIbge',
      'modalities',
      'keywords',
      'excludedKeywords',
      'minimumScore',
      'estimatedValueMinCents',
      'scoreWeights',
    ]));
    expect(typeof example.lookbackDays).toBe('number');
    expect(typeof example.minimumScore).toBe('number');
    expect(typeof example.estimatedValueMinCents).toBe('number');
  });

  it('redige dados sensíveis antes do log estruturado', async () => {
    const module = await import('../../src/observability/logger');
    const redactLogData = (module as unknown as { redactLogData?: (value: unknown) => unknown }).redactLogData;
    expect(redactLogData).toBeTypeOf('function');
    if (!redactLogData) return;

    const sanitized = redactLogData({
      email: 'operador@empresa.example',
      apiKey: 'sk-secret-key',
      headers: {
        authorization: 'Bearer secret-token',
        cookie: 'radar_session=secret-cookie',
      },
      pushSubscription: { endpoint: 'https://push.example/subscription', keys: { auth: 'push-secret' } },
      payload: { raw: 'sensitive-payload' },
      databaseUrl: 'file:./data/licitacoes.db?secret=database-secret',
      operation: 'sync',
    }) as Record<string, unknown>;
    const serialized = JSON.stringify(sanitized);

    expect(sanitized.email).toBe('o***@empresa.example');
    expect(serialized).not.toContain('operador@empresa.example');
    expect(serialized).not.toContain('sk-secret-key');
    expect(serialized).not.toContain('secret-token');
    expect(serialized).not.toContain('secret-cookie');
    expect(serialized).not.toContain('push-secret');
    expect(serialized).not.toContain('sensitive-payload');
    expect(serialized).not.toContain('database-secret');
    expect(sanitized.operation).toBe('sync');
  });

  it('documenta operação, pausas e restauração segura sem ação destrutiva automática', () => {
    const setup = readFileSync(join(root, 'SETUP.md'), 'utf8');
    const normalized = setup.toLowerCase();

    for (const phrase of [
      'resend_api_key',
      'web push',
      'npm run dev',
      'busca automática',
      'pausar manualmente',
      'pausa automaticamente',
      'bec_sp_enabled',
      'bec_sp_base_url',
      'npm run e2e:real',
      'backup',
      'npm run db:migrate',
      'worker',
    ]) {
      expect(normalized).toContain(phrase);
    }
    expect(normalized).toContain('backup de segurança antes da substituição');
    expect(normalized).toContain('reinicie o worker');
    expect(normalized).toContain('restauração nunca é executada automaticamente');
  });

  it('mantém o branding AptaGov no manifesto instalado', () => {
    const manifest = readFileSync(join(root, 'public/manifest.webmanifest'), 'utf8');

    expect(manifest).toContain('AptaGov');
    expect(manifest.toLowerCase()).not.toContain('radar de licitações');
  });
});
