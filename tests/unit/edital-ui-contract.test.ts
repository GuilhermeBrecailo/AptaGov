import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('contrato visual da análise de edital', () => {
  it('perfil técnico usa a API do perfil', () => {
    const page = readFileSync('app/pages/perfil.vue', 'utf8');
    expect(page).toContain('Perfil técnico');
    expect(page).toContain("'/api/company-profile'");
    expect(page).toContain('active="profile"');
  });

  it('painel cobre carregamento, perfil alterado e visita técnica', () => {
    const panel = readFileSync('app/components/EditalAnalysisPanel.vue', 'utf8');
    expect(panel).toContain('Analisar edital');
    expect(panel).toContain('Lendo o edital');
    expect(panel).toContain('Seu perfil mudou desde esta análise');
    expect(panel).toContain('Adicionar à agenda');
    expect(panel).toContain('Análise parcial: só o edital foi lido');
    expect(panel).toContain('Preencher perfil técnico');
  });

  it('detalhes da oportunidade incluem o painel e a navegação leva ao perfil', () => {
    expect(readFileSync('app/components/OpportunityDetails.vue', 'utf8')).toContain('<EditalAnalysisPanel');
    const drawer = readFileSync('app/components/AppNavDrawer.vue', 'utf8');
    expect(drawer).toContain('to="/perfil"');
    expect(drawer).toContain("'profile'");
    expect(readFileSync('app/components/AppShell.vue', 'utf8')).toContain("'profile'");
  });
});
