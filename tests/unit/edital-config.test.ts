import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadEnv } from '../../src/config/env';

describe('configuração da análise de edital', () => {
  it('carrega os valores informados e aplica defaults', () => {
    const env = loadEnv({ EDITAL_ANALYSIS_ORGANIZATION_IDS: '3, 7,x', ANTHROPIC_API_KEY: 'k' });
    expect(env.editalAnalysisOrganizationIds).toEqual([3, 7]);
    expect(env.editalAnalysisMonthlyLimit).toBe(30);
    expect(env.editalAnalysisModel).toBe('claude-opus-5-5');
    expect(env.anthropicApiKey).toBe('k');
  });

  it('usa valores vazios quando nada é configurado', () => {
    const env = loadEnv({});
    expect(env.editalAnalysisOrganizationIds).toEqual([]);
    expect(env.anthropicApiKey).toBe('');
  });

  it('documenta as variáveis no .env.example', () => {
    const example = readFileSync(join(resolve(process.cwd()), '.env.example'), 'utf8');
    expect(example).toContain('ANTHROPIC_API_KEY=');
    expect(example).toContain('EDITAL_ANALYSIS_ORGANIZATION_IDS=');
  });
});
