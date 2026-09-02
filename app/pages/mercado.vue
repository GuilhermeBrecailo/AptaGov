<script setup lang="ts">
import AppNavDrawer from '../components/AppNavDrawer.vue';
import MarketSummary from '../components/MarketSummary.vue';
import type { AuthPayload, MarketSummary as MarketSummaryData } from '../types';

const { data: auth, error: authError } = await useFetch<AuthPayload>('/api/auth/me');
if (authError.value) await navigateTo('/login');

const today = new Date();
const endOfPeriod = localDate(today);
const startOfPeriod = localDate(new Date(today.getFullYear(), today.getMonth() - 11, 1));
const dateFrom = ref(startOfPeriod);
const dateTo = ref(endOfPeriod);
const state = ref('');
const organization = ref('');
const normalizedDescription = ref('');
const itemCode = ref('');

const query = computed(() => ({
  dateFrom: dateFrom.value || undefined,
  dateTo: dateTo.value || undefined,
  state: state.value || undefined,
  organization: organization.value.trim() || undefined,
  normalizedDescription: normalizedDescription.value.trim() || undefined,
  itemCode: itemCode.value.trim() || undefined,
}));

const { data: summary, pending, error, refresh } = await useFetch<MarketSummaryData>('/api/market', {
  query,
  watch: false,
  default: () => ({
    state: 'INSUFFICIENT_DATA',
    message: 'Informe código, descrição e unidade no contexto da oportunidade quando necessário.',
    minimumObservations: 5,
    observationCount: 0,
    count: 0,
    minPriceCents: null,
    medianPriceCents: null,
    maxPriceCents: null,
    min: null,
    median: null,
    max: null,
    monthlySeries: [],
    purchaseCount: 0,
    topOrganizations: [],
    topRegions: [],
    modalityBreakdown: [],
    statusBreakdown: [],
    lastUpdatedAt: null,
    lastUpdate: null,
    sourceLinks: [],
    auditLinks: [],
  }),
});

function localDate(value: Date): string {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
}

async function applyFilters() {
  if (!dateFrom.value || !dateTo.value || dateFrom.value > dateTo.value) return;
  await refresh();
}

async function logout() {
  await $fetch('/api/auth/logout', { method: 'POST' });
  await navigateTo('/login');
}
</script>

<template>
  <div class="product-shell">
    <header class="app-topbar">
      <div class="topbar-brand-area">
        <AppNavDrawer :auth="auth" active="market" @logout="logout" />
        <div class="brand-lockup"><div class="brand-mark">A</div><div><span class="brand-name">AptaGov</span><span class="brand-caption">Inteligência para vender ao governo</span></div></div>
      </div>
      <div class="account-area"><div class="organization-chip"><span class="org-avatar">{{ auth?.organization.name.slice(0, 1).toUpperCase() }}</span><span>{{ auth?.organization.name }}</span></div><span class="user-name">{{ auth?.user.name }}</span><button class="topbar-action" type="button" @click="logout">Sair</button></div>
    </header>

    <main class="app-content market-page">
      <div class="app-heading"><div><span class="section-kicker">Inteligência de mercado</span><h1>Referências oficiais para decidir melhor</h1><p>Compare preços praticados, compras e fontes sem transformar histórico em promessa de resultado.</p></div></div>

      <section class="market-workbench">
        <header class="market-command-bar"><div><span class="section-kicker">Recorte auditável</span><h2>Consultar mercado</h2><p>Use o código e a descrição normalizada para manter a comparação tecnicamente compatível.</p></div></header>
        <form class="market-filters" aria-label="Filtros do mercado" @submit.prevent="applyFilters">
          <label><span>Período inicial</span><input v-model="dateFrom" type="date"></label>
          <label><span>Período final</span><input v-model="dateTo" type="date"></label>
          <label><span>Estado</span><select v-model="state"><option value="">Todos os estados</option><option v-for="uf in ['SP', 'RJ', 'MG', 'PR', 'SC', 'RS', 'GO', 'BA', 'DF']" :key="uf" :value="uf">{{ uf }}</option></select></label>
          <label><span>Órgão</span><input v-model="organization" type="text" placeholder="Nome exato do órgão"></label>
          <label class="market-filter-wide"><span>Descrição normalizada</span><input v-model="normalizedDescription" type="text" placeholder="Ex.: servico de suporte"></label>
          <label><span>Código do item</span><input v-model="itemCode" type="text" placeholder="CATMAT, CATSER ou código oficial"></label>
          <button class="btn btn-primary" type="submit" :disabled="pending">{{ pending ? 'Consultando…' : 'Aplicar filtros' }}</button>
        </form>
      </section>

      <div v-if="error" class="notice" role="alert">Não foi possível consultar o mercado agora. Tente novamente.</div>
      <MarketSummary :summary="summary ?? null" :loading="pending" :message="summary?.message" />
    </main>
  </div>
</template>
