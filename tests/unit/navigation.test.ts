import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('navegação autenticada do SaaS', () => {
  const drawer = readFileSync('app/components/AppNavDrawer.vue', 'utf8');
  const configuration = readFileSync('app/pages/configuracao.vue', 'utf8');
  const plan = readFileSync('app/pages/plano.vue', 'utf8');
  const home = readFileSync('app/pages/index.vue', 'utf8');
  const admin = readFileSync('app/pages/admin.vue', 'utf8');

  it('oferece hambúrguer, Painel, Configuração e Plano', () => {
    expect(drawer).toContain('aria-label="Abrir menu"');
    expect(drawer).toContain('Painel');
    expect(drawer).toContain('Configuração');
    expect(drawer).toContain('Plano');
    expect(drawer).toContain('to="/configuracao"');
    expect(drawer).toContain('to="/plano"');
  });

  it('exibe Dashboard somente para o administrador da plataforma', () => {
    expect(drawer).toContain('v-if="auth?.isPlatformAdmin"');
    expect(drawer).toContain('to="/admin"');
    expect(drawer).toContain('Dashboard');
  });

  it('mantém Configuração e Plano como páginas autenticadas', () => {
    expect(configuration).toContain("useFetch<AuthPayload>('/api/auth/me')");
    expect(configuration).toContain("useFetch<FilterConfig>('/api/filters')");
    expect(configuration).toContain('Palavras-chave');
    expect(configuration).toContain('Peso de palavras-chave');
    expect(plan).toContain("useFetch<BillingPayload>('/api/billing')");
    expect(plan).toContain('BillingPlans');
    expect(plan).toContain('Plano atual');
    expect(home).toContain('<AppNavDrawer');
    expect(admin).toContain('<AppNavDrawer');
    expect(home).not.toContain('class="settings-card"');
    expect(home).not.toContain('class="billing-card"');
    expect(configuration).toContain('enableDeviceNotifications');
  });
});
