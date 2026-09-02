<script setup lang="ts">
import type { AuthPayload, PlatformAdminMetrics, SourceHealthMetrics } from '../types';

const { data: auth, error: authError } = await useFetch<AuthPayload>('/api/auth/me');
if (authError.value) await navigateTo('/login');

const { data: metrics, error: metricsError, refresh } = await useFetch<PlatformAdminMetrics>('/api/admin/metrics');
const { data: sourceHealth, error: sourceHealthError, refresh: refreshSourceHealth } = await useFetch<SourceHealthMetrics>('/api/source-health');

async function logout() {
  await $fetch('/api/auth/logout', { method: 'POST' });
  await navigateTo('/login');
}

function price(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function date(value: string): string {
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium' }).format(new Date(value));
}

function planName(code: string): string {
  return metrics.value?.plans.find((plan) => plan.code === code)?.name ?? 'Inicial';
}

function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    ACTIVE: 'Ativa',
    TRIALING: 'Teste',
    PAST_DUE: 'Pagamento pendente',
    CANCELED: 'Cancelada',
    INACTIVE: 'Inativa',
  };
  return labels[status] ?? status;
}

function healthLabel(status: string): string {
  const labels: Record<string, string> = {
    HEALTHY: 'Saudável',
    DEGRADED: 'Degradada',
    UNAVAILABLE: 'Indisponível',
    DISABLED: 'Desabilitada',
    UNKNOWN: 'Sem execução',
  };
  return labels[status] ?? status;
}

function dateTime(value: string | null): string {
  if (!value) return 'Ainda não executada';
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
}

function backupAge(value: number | null): string {
  if (value === null) return 'Nenhum backup válido';
  const hours = Math.floor(value / 3_600_000);
  if (hours < 24) return `${hours}h atrás`;
  return `${Math.floor(hours / 24)}d atrás`;
}

async function refreshAll() {
  await Promise.all([refresh(), refreshSourceHealth()]);
}
</script>

<template>
  <div class="product-shell admin-shell">
    <header class="app-topbar">
      <div class="topbar-brand-area">
        <AppNavDrawer :auth="auth" active="admin" @logout="logout" />
        <div class="brand-lockup"><div class="brand-mark">A</div><div><span class="brand-name">AptaGov</span><span class="brand-caption">Visão privada da operação</span></div></div>
      </div>
      <div class="account-area"><span class="user-name">{{ auth?.user.name }}</span><NuxtLink class="topbar-action" to="/">Voltar ao painel</NuxtLink><button class="topbar-action" type="button" @click="logout">Sair</button></div>
    </header>

    <main class="app-content">
      <div class="app-heading">
        <div><span class="section-kicker">Painel do proprietário</span><h1>Visão do negócio</h1><p>Uma leitura rápida de adoção, receita e saúde da base.</p></div>
        <button class="btn btn-ghost" @click="refreshAll">Atualizar dados</button>
      </div>

      <div v-if="metricsError" class="notice warning">Este painel é restrito ao administrador configurado.</div>
      <template v-else-if="metrics">
        <section class="metric-strip admin-metric-strip">
          <div><small>Empresas cadastradas</small><strong>{{ metrics.summary.organizations }}</strong><span>organizações na base</span></div>
          <div><small>Assinaturas ativas</small><strong>{{ metrics.summary.activeSubscriptions }}</strong><span>{{ metrics.summary.trialingOrganizations }} em teste</span></div>
          <div><small>MRR estimado</small><strong>{{ price(metrics.summary.estimatedMrrCents) }}</strong><span>recorrência dos planos ativos</span></div>
          <div><small>Usuários</small><strong>{{ metrics.summary.users }}</strong><span>contas cadastradas</span></div>
        </section>

        <section class="admin-secondary-metrics">
          <div><span class="section-kicker">Atenção</span><strong>{{ metrics.summary.pastDueOrganizations }}</strong><p>empresas com pagamento pendente</p></div>
          <div><span class="section-kicker">Oportunidades</span><strong>{{ metrics.summary.opportunities.toLocaleString('pt-BR') }}</strong><p>registros no radar</p></div>
          <div><span class="section-kicker">Alertas no mês</span><strong>{{ metrics.summary.notificationsThisMonth.toLocaleString('pt-BR') }}</strong><p>e-mail e PWA enfileirados</p></div>
          <div><span class="section-kicker">Ativação</span><strong>{{ metrics.summary.completedOnboardingOrganizations }} / {{ metrics.summary.organizations }}</strong><p>empresas que concluíram o primeiro radar</p></div>
          <div><span class="section-kicker">Radares</span><strong>{{ metrics.summary.activeRadars }}</strong><p>buscas ativas no momento</p></div>
          <div><span class="section-kicker">Aderência</span><strong>{{ metrics.summary.favoritedOpportunities }}</strong><p>oportunidades favoritadas</p></div>
          <div><span class="section-kicker">Pipeline</span><strong>{{ metrics.summary.kanbanOpportunities }}</strong><p>oportunidades no Kanban</p></div>
        </section>

        <section v-if="sourceHealth || sourceHealthError" class="admin-surface admin-health-panel">
          <div v-if="sourceHealth" class="list-heading">
            <div><span class="section-kicker">Operação protegida</span><h2>Saúde das fontes</h2></div>
            <span class="pagination-label">Última execução: {{ dateTime(sourceHealth.lastSuccessfulRunAt) }}</span>
          </div>
          <div v-if="sourceHealth" class="source-health-grid">
            <article v-for="source in sourceHealth.sources" :key="source.source" class="source-health-card">
              <div class="source-health-heading"><strong>{{ source.source }}</strong><span class="status-pill" :class="`status-${source.status.toLowerCase()}`">{{ healthLabel(source.status) }}</span></div>
              <small>Último sucesso: {{ dateTime(source.lastSuccessfulRunAt) }}</small>
              <small>Checkpoint: {{ source.checkpoint ?? 'não iniciado' }}</small>
              <small v-if="source.lastErrorCategory">Último erro: {{ source.lastErrorCategory }}</small>
            </article>
          </div>
          <div v-if="sourceHealthError" class="notice warning">A saúde das fontes não pôde ser atualizada.</div>
          <div v-if="sourceHealth" class="admin-health-summary">
            <div><span>Profundidade da fila</span><strong>{{ sourceHealth.queueDepth }}</strong></div>
            <div><span>Falhas de notificação</span><strong>{{ sourceHealth.notificationFailures }}</strong></div>
            <div><span>Idade do backup</span><strong>{{ backupAge(sourceHealth.backupAgeMs) }}</strong><small>{{ dateTime(sourceHealth.lastBackupAt) }}</small></div>
            <div><span>Motivo de pausa</span><strong>{{ sourceHealth.pauseReason ?? 'Operação ativa' }}</strong></div>
          </div>
        </section>

        <section class="admin-grid">
          <div class="admin-surface">
            <div class="list-heading"><div><span class="section-kicker">Distribuição comercial</span><h2>Planos e receita</h2></div></div>
            <div class="admin-plan-list">
              <div v-for="plan in metrics.plans" :key="plan.code" class="admin-plan-row">
                <div><strong>{{ plan.name }}</strong><span>{{ price(plan.priceCents) }}/mês · {{ plan.description }}</span></div>
                <div class="admin-plan-numbers"><strong>{{ plan.organizationCount }}</strong><span>{{ plan.activeCount }} ativas · {{ price(plan.estimatedMrrCents) }}</span></div>
              </div>
            </div>
          </div>

          <div class="admin-surface admin-reading-card">
            <span class="section-kicker">Leitura rápida</span>
            <h2>Quando aumentar o valor</h2>
            <p>Use o crescimento de empresas ativas, a concentração no plano Inicial e a quantidade de alertas para decidir quando testar o próximo preço.</p>
            <div class="admin-reading-rule"><span>Base pagante</span><strong>{{ metrics.summary.activeSubscriptions }} de {{ metrics.summary.organizations }}</strong></div>
            <div class="admin-reading-rule"><span>MRR médio por pagante</span><strong>{{ metrics.summary.activeSubscriptions ? price(Math.round(metrics.summary.estimatedMrrCents / metrics.summary.activeSubscriptions)) : 'R$0,00' }}</strong></div>
          </div>
        </section>

        <section class="admin-surface admin-organizations">
          <div class="list-heading"><div><span class="section-kicker">Base recente</span><h2>Empresas usando o sistema</h2></div><span class="pagination-label">Atualizado em {{ date(metrics.generatedAt) }}</span></div>
          <div class="admin-table-wrap">
            <table class="admin-table">
              <thead><tr><th>Empresa</th><th>Responsável</th><th>Plano</th><th>Status</th><th>Cadastro</th></tr></thead>
              <tbody>
                <tr v-for="organization in metrics.recentOrganizations" :key="organization.id">
                  <td><strong>{{ organization.name }}</strong></td>
                  <td>{{ organization.ownerEmail }}</td>
                  <td>{{ planName(organization.planCode) }}</td>
                  <td><span class="status-pill" :class="`status-${organization.status.toLowerCase()}`">{{ statusLabel(organization.status) }}</span></td>
                  <td>{{ date(organization.createdAt) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </template>
    </main>
  </div>
</template>
