<script setup lang="ts">
import { watch } from 'vue';
import { useRoute } from 'vue-router';
import OpportunityCatalog from '../components/OpportunityCatalog.vue';
import OpportunityDetails from '../components/OpportunityDetails.vue';
import OpportunityKanban from '../components/OpportunityKanban.vue';
import { getKanbanItems } from '../viewModels/operationalViewModels';
import type { AuthPayload, CatalogOpportunity, CatalogPage, ChecklistItem, ChecklistPatchInput, FilterConfig, KanbanState, SavedSearch, SyncSettings } from '../types';

const {
  isOnline,
  canInstall,
  installed,
  install,
} = usePwa();
const { data: auth, error: authError } = await useFetch<AuthPayload>('/api/auth/me');
if (authError.value) await navigateTo('/login');
const route = useRoute();

const { data: filters } = await useFetch<FilterConfig>('/api/filters');
const { data: radarPayload } = await useFetch<{ data: SavedSearch[]; limit: number | null }>('/api/radars', {
  default: () => ({ data: [], limit: 3 }),
});
const { data: status, refresh: refreshStatus } = await useFetch<{ pause: { paused: boolean; reason: string | null }; opportunities: number; automaticSync: SyncSettings }>('/api/status', {
  default: () => ({ pause: { paused: false, reason: null }, opportunities: 0, automaticSync: { enabled: true, intervalMinutes: 10 } }),
});

const activeView = ref<'catalog' | 'kanban'>(route.query.opportunity ? 'kanban' : 'catalog');
const searchInput = ref('');
const searchTerm = ref('');
const stateInput = ref('');
const selected = ref<CatalogOpportunity | null>(null);
const selectedRadarId = ref<number | undefined>();
const sortInput = ref<'score' | 'deadline' | 'publication'>('score');
const openDeadlineOnly = ref(false);
const page = ref(1);
const busy = ref(false);
const message = ref('');
const states = ['', 'SP', 'RJ', 'MG', 'PR', 'SC', 'RS', 'GO', 'BA', 'DF'];
const selectedRadar = computed(() => radarPayload.value?.data.find((radar) => radar.id === selectedRadarId.value));
const focusedOpportunityId = computed(() => {
  const raw = route.query.opportunity;
  if (typeof raw !== 'string') return undefined;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
});
const checklistByOpportunity = ref<Record<number, ChecklistItem[]>>({});
const checklistLoadingIds = ref<number[]>([]);
const checklistSavingIds = ref<number[]>([]);

const query = computed(() => {
  if (activeView.value === 'kanban' && focusedOpportunityId.value !== undefined) {
    return {
      opportunity: route.query.opportunity,
      opportunityId: focusedOpportunityId.value,
      page: 1,
      pageSize: 1,
    };
  }
  return {
    q: searchTerm.value || undefined,
    minScore: selectedRadar.value?.filters.minimumScore ?? filters.value?.minimumScore ?? 0,
    state: stateInput.value || undefined,
    radarId: selectedRadarId.value,
    sort: sortInput.value,
    openDeadlineOnly: openDeadlineOnly.value,
    hideNotRelevant: activeView.value === 'catalog',
    page: page.value,
    pageSize: activeView.value === 'kanban' ? 50 : 20,
    kanbanOnly: activeView.value === 'kanban',
    opportunity: route.query.opportunity,
  };
});
const { data: catalog, pending: catalogLoading, refresh: refreshCatalog } = await useFetch<CatalogPage>('/api/opportunities', {
  query,
  default: () => ({ data: [], total: 0, page: 1, pageSize: 20, totalPages: 1 }),
});

const authorizedItems = computed(() => catalog.value?.data ?? []);
const kanbanItems = computed(() => getKanbanItems(authorizedItems.value));
const averageScore = computed(() => Math.round(authorizedItems.value.reduce((sum, item) => sum + item.score, 0) / Math.max(1, authorizedItems.value.length)));

watch([authorizedItems, () => route.query.opportunity], ([currentItems, opportunity]) => {
  const opportunityId = Number(opportunity);
  if (!Number.isInteger(opportunityId)) return;
  selected.value = currentItems.find((item) => item.id === opportunityId) ?? selected.value;
}, { immediate: true });

watch([kanbanItems, activeView], ([currentItems, view]) => {
  if (view !== 'kanban') return;
  void Promise.all(currentItems.map((item) => loadChecklist(item.id)));
}, { immediate: true });

watch(selected, (item) => {
  if (item?.inKanban) void loadChecklist(item.id);
});

async function applySearch() {
  searchTerm.value = searchInput.value.trim();
  page.value = 1;
  await refreshCatalog();
}

async function selectRadar() {
  page.value = 1;
  await refreshCatalog();
}

async function selectView(view: 'catalog' | 'kanban') {
  activeView.value = view;
  page.value = 1;
  await refreshCatalog();
}

async function addToKanban(item: CatalogOpportunity) {
  await $fetch(`/api/opportunities/${item.id}/kanban`, { method: 'POST' });
  message.value = 'Licitação adicionada ao seu kanban.';
  await refreshCatalog();
  await loadChecklist(item.id, true);
}

async function updateFeedback(item: CatalogOpportunity, status: 'FAVORITED' | 'NOT_RELEVANT' | null) {
  await $fetch(`/api/opportunities/${item.id}/feedback`, { method: 'POST', body: { status } });
  message.value = status === 'FAVORITED' ? 'Oportunidade adicionada às favoritas.' : status === 'NOT_RELEVANT' ? 'Oportunidade retirada do catálogo.' : 'Preferência atualizada.';
  selected.value = null;
  await refreshCatalog();
}

async function changeState(item: CatalogOpportunity, state: KanbanState) {
  await $fetch(`/api/opportunities/${item.id}/state`, { method: 'PATCH', body: { state } });
  message.value = 'Etapa atualizada.';
  await refreshCatalog();
}

async function loadChecklist(opportunityId: number, force = false) {
  if (!force && checklistByOpportunity.value[opportunityId]) return;
  if (checklistLoadingIds.value.includes(opportunityId)) return;
  checklistLoadingIds.value = [...checklistLoadingIds.value, opportunityId];
  try {
    const checklist = await $fetch<ChecklistItem[]>(`/api/opportunities/${opportunityId}/checklist`);
    checklistByOpportunity.value = { ...checklistByOpportunity.value, [opportunityId]: checklist };
  } catch (error) {
    message.value = error instanceof Error ? error.message : 'Não foi possível carregar a preparação.';
  } finally {
    checklistLoadingIds.value = checklistLoadingIds.value.filter((id) => id !== opportunityId);
  }
}

async function completeChecklistItem(opportunityId: number, itemId: number) {
  await saveChecklistItem(opportunityId, itemId, { status: 'COMPLETED' });
}

async function saveChecklistItem(opportunityId: number, itemId: number, patch: ChecklistPatchInput) {
  if (checklistSavingIds.value.includes(itemId)) return;
  checklistSavingIds.value = [...checklistSavingIds.value, itemId];
  try {
    const updated = await $fetch<ChecklistItem>(`/api/opportunities/${opportunityId}/checklist/${itemId}`, {
      method: 'PATCH',
      body: patch,
    });
    const current = checklistByOpportunity.value[opportunityId] ?? [];
    checklistByOpportunity.value = {
      ...checklistByOpportunity.value,
      [opportunityId]: current.map((item) => item.id === itemId ? updated : item),
    };
    message.value = patch.status === 'COMPLETED' ? 'Item de preparação concluído.' : 'Item de preparação atualizado.';
  } finally {
    checklistSavingIds.value = checklistSavingIds.value.filter((id) => id !== itemId);
  }
}

async function syncNow() {
  busy.value = true;
  message.value = '';
  try {
    const result = await $fetch<{ paused: boolean; reason?: string | null }>('/api/sync', { method: 'POST', body: { radarId: selectedRadarId.value } });
    message.value = result.paused
      ? `Sincronização pausada: ${result.reason ?? 'verifique o status do worker'}.`
      : 'Sincronização concluída.';
    await Promise.all([refreshCatalog(), refreshStatus()]);
  } catch (error) {
    message.value = error instanceof Error ? error.message : 'Sincronização pausada.';
    await refreshStatus();
  } finally {
    busy.value = false;
  }
}

async function togglePause() {
  if (status.value?.pause.paused) await $fetch('/api/worker/resume', { method: 'POST' });
  else await $fetch('/api/worker/pause', { method: 'POST', body: { reason: 'manual_pause' } });
  await refreshStatus();
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
        <AppNavDrawer :auth="auth" active="panel" @logout="logout" />
        <div class="brand-lockup"><div class="brand-mark">A</div><div><span class="brand-name">AptaGov</span><span class="brand-caption">Inteligência para vender ao governo</span></div></div>
      </div>
      <div class="account-area"><div class="organization-chip"><span class="org-avatar">{{ auth?.organization.name.slice(0, 1).toUpperCase() }}</span><span>{{ auth?.organization.name }}</span></div><span class="user-name">{{ auth?.user.name }}</span><button class="topbar-action" type="button" @click="logout">Sair</button></div>
    </header>

    <main class="app-content">
      <div class="app-heading"><div><span class="section-kicker">Seu espaço de oportunidades</span><h1>{{ activeView === 'catalog' ? 'Licitações encontradas' : 'Meu kanban' }}</h1><p>{{ activeView === 'catalog' ? 'Pesquise o mercado e escolha o que merece sua atenção.' : 'Acompanhe as oportunidades que sua empresa decidiu disputar.' }}</p></div><button class="btn btn-primary" :disabled="busy" @click="syncNow">{{ busy ? 'Sincronizando…' : 'Sincronizar PNCP' }}</button></div>
      <div class="pwa-status" :class="{ offline: !isOnline }"><span class="connection-dot" /><span>{{ isOnline ? 'Online' : 'Sem conexão' }}</span><button v-if="canInstall && !installed" class="install-button" @click="install">Instalar aplicativo</button><span v-else-if="installed" class="installed-label">Aplicativo instalado</span></div>

      <nav class="view-tabs" aria-label="Navegação principal"><button :class="{ active: activeView === 'catalog' }" @click="selectView('catalog')"><span>▦</span>Licitações<span class="tab-count">{{ activeView === 'catalog' ? catalog?.total ?? 0 : status?.opportunities ?? 0 }}</span></button><button :class="{ active: activeView === 'kanban' }" @click="selectView('kanban')"><span>▥</span>Meu kanban<span class="tab-count">{{ activeView === 'kanban' ? catalog?.total ?? 0 : '→' }}</span></button></nav>
      <div v-if="message" class="notice">{{ message }}</div>
      <div v-if="status?.pause.paused" class="notice warning">Sincronização pausada: {{ status.pause.reason }}. Verifique a causa antes de retomar.<button v-if="auth?.role === 'OWNER'" class="text-action" @click="togglePause">Retomar</button></div>

      <section class="metric-strip"><div><small>Oportunidades no radar</small><strong>{{ catalog?.total ?? 0 }}</strong><span>resultado desta visão</span></div><div><small>Score médio</small><strong>{{ averageScore }}</strong><span>aderência calculada</span></div><div><small>Empresa</small><strong class="metric-company">{{ auth?.organization.name }}</strong><span>ambiente privado</span></div></section>

      <div v-if="activeView === 'catalog'" class="catalog-layout">
        <section class="content-surface">
          <div class="search-toolbar"><div class="search-box"><span>⌕</span><input v-model="searchInput" aria-label="Pesquisar licitações" placeholder="Pesquisar licitações por título, órgão ou descrição" @keyup.enter="applySearch"><button class="search-submit" @click="applySearch">Pesquisar</button></div><select v-model="stateInput" aria-label="Filtrar por estado" @change="applySearch"><option v-for="state in states" :key="state" :value="state">{{ state || 'Todos os estados' }}</option></select><span class="result-count">{{ catalog?.total ?? 0 }} resultados</span></div>
          <div class="list-heading"><div><span class="section-kicker">Catálogo PNCP</span><h2>Escolha o que entra no seu pipeline</h2></div><span class="pagination-label">Página {{ catalog?.page ?? 1 }} de {{ catalog?.totalPages ?? 1 }}</span></div>
          <div class="catalog-filters" aria-label="Filtros rápidos">
            <label class="quick-filter"><span>Radar</span><select v-model.number="selectedRadarId" @change="selectRadar"><option :value="undefined">Todos os radares</option><option v-for="radar in radarPayload?.data" :key="radar.id" :value="radar.id">{{ radar.name }}{{ radar.enabled ? '' : ' (pausado)' }}</option></select></label>
            <label class="quick-filter"><span>Ordenar por</span><select v-model="sortInput" @change="applySearch"><option value="score">Maior aderência</option><option value="deadline">Prazo mais próximo</option><option value="publication">Mais recentes</option></select></label>
            <label class="quick-check"><input v-model="openDeadlineOnly" type="checkbox" @change="applySearch"><span>Somente com prazo aberto</span></label>
          </div>
          <OpportunityCatalog :items="authorizedItems" :loading="catalogLoading" @select="selected = $event" @add="addToKanban" @feedback="updateFeedback" />
          <div class="pagination"><button class="btn btn-ghost" :disabled="(catalog?.page ?? 1) <= 1" @click="page -= 1">← Anterior</button><span>{{ catalog?.page ?? 1 }} / {{ catalog?.totalPages ?? 1 }}</span><button class="btn btn-ghost" :disabled="(catalog?.page ?? 1) >= (catalog?.totalPages ?? 1)" @click="page += 1">Próxima →</button></div>
        </section>
      </div>

      <section v-else class="kanban-surface"><div class="list-heading"><div><span class="section-kicker">Pipeline da empresa</span><h2>Do interesse à decisão</h2></div><button class="btn btn-ghost" @click="selectView('catalog')">+ Buscar licitações</button></div><OpportunityKanban :items="kanbanItems" :loading="catalogLoading" :checklists="checklistByOpportunity" :checklist-loading-ids="checklistLoadingIds" :checklist-saving-ids="checklistSavingIds" :current-user="auth?.user ?? null" @select="selected = $event" @change-state="changeState" @checklist-complete="completeChecklistItem($event.opportunityId, $event.itemId)" @checklist-save="saveChecklistItem($event.opportunityId, $event.itemId, $event.patch)" /></section>
    </main>
    <OpportunityDetails :item="selected" :checklist-items="selected ? checklistByOpportunity[selected.id] ?? [] : []" :checklist-loading="selected ? checklistLoadingIds.includes(selected.id) : false" :checklist-saving="checklistSavingIds.length > 0" :current-user="auth?.user ?? null" @close="selected = null" @feedback="updateFeedback(selected!, $event)" @checklist-complete="selected && completeChecklistItem(selected.id, $event)" @checklist-save="(itemId, patch) => selected && saveChecklistItem(selected.id, itemId, patch)" />
  </div>
</template>
