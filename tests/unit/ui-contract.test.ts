import { readFileSync } from 'node:fs';
import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('contrato visual do SaaS', () => {
  it('oferece catálogo, kanban e autenticação em português', () => {
    const home = readFileSync('app/pages/index.vue', 'utf8');
    const catalog = readFileSync('app/components/OpportunityCatalog.vue', 'utf8');
    const details = readFileSync('app/components/OpportunityDetails.vue', 'utf8');
    const plans = readFileSync('app/components/BillingPlans.vue', 'utf8');
    const login = readFileSync('app/pages/login.vue', 'utf8');
    const signup = readFileSync('app/pages/cadastro.vue', 'utf8');
    const configuration = readFileSync('app/pages/configuracao.vue', 'utf8');
    const onboarding = readFileSync('app/pages/boas-vindas.vue', 'utf8');
    const radarList = readFileSync('app/components/RadarList.vue', 'utf8');
    const radarEditor = readFileSync('app/components/RadarEditor.vue', 'utf8');

    expect(home).toContain('Licitações');
    expect(home).toContain('Meu kanban');
    expect(home).toContain('OpportunityCatalog');
    expect(configuration).toContain('Notificações');
    expect(configuration).toContain('Ativar alertas por e-mail');
    expect(catalog).toContain('Adicionar ao kanban');
    expect(catalog).toContain('Favoritar');
    expect(details).toContain('Não é relevante');
    expect(home).toContain('Pesquisar licitações');
    expect(login).toContain('Entrar');
    expect(signup).toContain('Criar minha conta');
    expect(home).not.toContain('Assinatura');
    expect(home).not.toContain('BillingPlans');
    expect(plans).toContain('Escolher ${plan.name}');
    expect(plans).toContain('radarLimit');
    expect(configuration).toContain('Peso de palavras-chave');
    expect(radarList).toContain('Radares salvos');
    expect(radarList).toContain('toggleNotifications');
    expect(radarEditor).toContain('Enviar notificações');
    expect(onboarding).toContain('Criar meu radar');
    expect(login).toContain('Seu radar de oportunidades');
    expect(login).toContain('auth-benefit-list');
    expect(login).toContain('auth-security-note');
    expect(home).toContain('result.paused');
    expect(home).toContain("auth?.role === 'OWNER'");
    expect(existsSync('app/pages/admin.vue')).toBe(true);
  });
});
