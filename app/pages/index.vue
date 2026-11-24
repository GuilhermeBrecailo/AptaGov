<script setup lang="ts">
import OpportunityCatalog from '../components/OpportunityCatalog.vue';
import OpportunityDetails from '../components/OpportunityDetails.vue';
import OpportunityKanban from '../components/OpportunityKanban.vue';
import { useOpportunityWorkspace, type WorkspaceStatus } from '../composables/useOpportunityWorkspace';
import { BRAZIL_STATES } from '../utils/format';
import type { AuthPayload, FilterConfig, SavedSearch } from '../types';

const { isOnline, canInstall, installed, install } = usePwa();
const { data: auth, error: authError } = await useFetch<AuthPayload>('/api/auth/me');
if (authError.value) await navigateTo('/login');

const { data: filters } = await useFetch<FilterConfig>('/api/filters');
const { data: radarPayload } = await useFetch<{ data: SavedSearch[]; limit: number | null }>('/api/radars', {
  default: () => ({ data: [], limit: 3 }),
});
const { data: status, refresh: refreshStatus } = await useFetch<WorkspaceStatus>('/api/status', {
  default: () => ({ pause: { paused: false, reason: null }, opportunities: 0, automaticSync: { enabled: true, intervalMinutes: 10 } }),
});

const workspace = useOpportunityWorkspace({ filters, radarPayload, status, refreshStatus });
await workspace.catalogRequest;

const {
  activeView, searchInput, stateInput, selected, selectedRadarId, sortInput, openDeadlineOnly, page, busy, message,
  checklistByOpportunity, checklistLoadingIds, checklistSavingIds, catalog, catalogLoading,
  authorizedItems, kanbanItems,
  applySearch, selectRadar, selectView, addToKanban, updateFeedback, changeState, completeChecklistItem, saveChecklistItem, syncNow, togglePause,
} = workspace;

const totalCount = computed(() => (catalog.value?.total ?? 0).toLocaleString('pt-BR'));
</script>

<template>
  <AppShell :auth="auth" active="panel">
    <header class="page-header">
      <div class="page-title">
        <h1>{{ activeView === 'catalog' ? 'Licitações' : 'Meu kanban' }}</h1>
        <span class="page-count">{{ totalCount }}</span>
      </div>
      <div class="page-actions">
        <span v-if="!isOnline" class="offline-pill" role="status">Sem conexão</span>
        <button v-if="canInstall && !installed" class="btn btn-ghost btn-small" @click="install">Instalar aplicativo</button>
        <button class="btn btn-primary" :disabled="busy" @click="syncNow">{{ busy ? 'Atualizando…' : 'Atualizar agora' }}</button>
      </div>
    </header>

    <nav class="view-tabs" aria-label="Visão do painel">
      <button :class="{ active: activeView === 'catalog' }" :aria-pressed="activeView === 'catalog'" @click="selectView('catalog')">Licitações</button>
      <button :class="{ active: activeView === 'kanban' }" :aria-pressed="activeView === 'kanban'" @click="selectView('kanban')">Meu kanban</button>
    </nav>

    <div v-if="message" class="notice" role="status">{{ message }}</div>
    <div v-if="status?.pause.paused" class="notice warning" role="alert">Atualização pausada: {{ status.pause.reason }}.<button v-if="auth?.role === 'OWNER'" class="text-action" @click="togglePause">Retomar</button></div>

    <section v-if="activeView === 'catalog'" class="content-surface">
      <div class="filter-bar">
        <input v-model="searchInput" class="filter-search" type="search" aria-label="Pesquisar licitações" placeholder="Pesquisar licitações" @keyup.enter="applySearch" @search="applySearch">
        <select v-model="stateInput" aria-label="Estado" @change="applySearch"><option value="">Todos os estados</option><option v-for="uf in BRAZIL_STATES" :key="uf" :value="uf">{{ uf }}</option></select>
        <select v-model.number="selectedRadarId" aria-label="Radar" @change="selectRadar"><option :value="undefined">Todos os radares</option><option v-for="radar in radarPayload?.data" :key="radar.id" :value="radar.id">{{ radar.name }}{{ radar.enabled ? '' : ' (pausado)' }}</option></select>
        <select v-model="sortInput" aria-label="Ordenar" @change="applySearch"><option value="score">Mais aderentes</option><option value="deadline">Prazo mais próximo</option><option value="publication">Mais recentes</option></select>
        <label class="filter-check"><input v-model="openDeadlineOnly" type="checkbox" @change="applySearch">Só prazo aberto</label>
      </div>
      <OpportunityCatalog :items="authorizedItems" :loading="catalogLoading" @select="selected = $event" @add="addToKanban" @feedback="updateFeedback" />
      <div v-if="(catalog?.totalPages ?? 1) > 1" class="pagination"><button class="btn btn-ghost btn-small" :disabled="(catalog?.page ?? 1) <= 1" @click="page -= 1">Anterior</button><span>Página {{ catalog?.page ?? 1 }} de {{ catalog?.totalPages ?? 1 }}</span><button class="btn btn-ghost btn-small" :disabled="(catalog?.page ?? 1) >= (catalog?.totalPages ?? 1)" @click="page += 1">Próxima</button></div>
    </section>

    <section v-else>
      <OpportunityKanban :items="kanbanItems" :loading="catalogLoading" :checklists="checklistByOpportunity" :checklist-loading-ids="checklistLoadingIds" :checklist-saving-ids="checklistSavingIds" :current-user="auth?.user ?? null" @select="selected = $event" @change-state="changeState" @checklist-complete="completeChecklistItem($event.opportunityId, $event.itemId)" @checklist-save="saveChecklistItem($event.opportunityId, $event.itemId, $event.patch)" />
    </section>

    <OpportunityDetails :item="selected" :checklist-items="selected ? checklistByOpportunity[selected.id] ?? [] : []" :checklist-loading="selected ? checklistLoadingIds.includes(selected.id) : false" :checklist-saving="checklistSavingIds.length > 0" :current-user="auth?.user ?? null" @close="selected = null" @feedback="updateFeedback(selected!, $event)" @checklist-complete="selected && completeChecklistItem(selected.id, $event)" @checklist-save="(itemId, patch) => selected && saveChecklistItem(selected.id, itemId, patch)" />
  </AppShell>
</template>
