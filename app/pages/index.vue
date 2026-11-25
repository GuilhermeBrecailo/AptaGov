<script setup lang="ts">
import OpportunityCatalog from '../components/OpportunityCatalog.vue';
import OpportunityDetails from '../components/OpportunityDetails.vue';
import OpportunityKanban from '../components/OpportunityKanban.vue';
import { useOpportunityWorkspace, type WorkspaceStatus } from '../composables/useOpportunityWorkspace';
import { BRAZIL_STATES } from '../utils/format';
import {
  SITUATION_OPTIONS, DEFAULT_CATALOG_FILTERS, activeFilterChips, countAdvancedFilters, type CatalogFilterState, type SituationFilter,
} from '../viewModels/catalogFiltersViewModel';
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
  activeView, searchInput, stateInput, selected, selectedRadarId, sortInput, openDeadlineOnly, page, busy, message, catalogFilters, facets,
  checklistByOpportunity, checklistLoadingIds, checklistSavingIds, catalog, catalogLoading,
  authorizedItems, kanbanItems,
  applySearch, setCatalogFilters, removeCatalogFilter, clearCatalogFilters, applyStateFilter, selectRadar, selectView, addToKanban, updateFeedback, changeState, completeChecklistItem, saveChecklistItem, syncNow, togglePause,
} = workspace;

const filtersOpen = ref(false);
const filterChips = computed(() => activeFilterChips(catalogFilters.value));
const advancedCount = computed(() => countAdvancedFilters(catalogFilters.value));
const filtersAreDefault = computed(() => JSON.stringify(catalogFilters.value) === JSON.stringify(DEFAULT_CATALOG_FILTERS));

function patchFilters(patch: Partial<CatalogFilterState>) {
  return setCatalogFilters({ ...catalogFilters.value, ...patch });
}
function toggleValue(field: 'modalities' | 'disputeModes', value: string) {
  const current = catalogFilters.value[field];
  return patchFilters({ [field]: current.includes(value) ? current.filter((item) => item !== value) : [...current, value] });
}
async function onStateChange() {
  await applyStateFilter();
  await applySearch();
}
function onDate(field: 'publishedFrom' | 'publishedTo' | 'deadlineFrom' | 'deadlineTo', event: Event) {
  return patchFilters({ [field]: (event.target as { value: string }).value });
}

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
        <select v-model="stateInput" aria-label="Estado" @change="onStateChange"><option value="">Todos os estados</option><option v-for="uf in BRAZIL_STATES" :key="uf" :value="uf">{{ uf }}</option></select>
        <select v-model.number="selectedRadarId" aria-label="Radar" @change="selectRadar"><option :value="undefined">Todos os radares</option><option v-for="radar in radarPayload?.data" :key="radar.id" :value="radar.id">{{ radar.name }}{{ radar.enabled ? '' : ' (pausado)' }}</option></select>
        <select v-model="sortInput" aria-label="Ordenar" @change="applySearch"><option value="score">Mais aderentes</option><option value="deadline">Prazo mais próximo</option><option value="publication">Mais recentes</option></select>
        <label class="filter-check"><input v-model="openDeadlineOnly" type="checkbox" @change="applySearch">Só prazo aberto</label>
        <button type="button" class="btn btn-ghost btn-small" aria-controls="more-filters-panel" :aria-expanded="filtersOpen" @click="filtersOpen = !filtersOpen">
          Mais filtros<span v-if="advancedCount" class="count-badge" aria-label="filtros ativos">{{ advancedCount }}</span>
        </button>
      </div>
      <div v-if="filtersOpen" id="more-filters-panel" class="filter-panel" role="group" aria-label="Mais filtros" @keydown.esc="filtersOpen = false">
        <label class="filter-field"><span>Situação</span>
          <select :value="catalogFilters.situation" @change="patchFilters({ situation: ($event.target as { value: string }).value as SituationFilter })">
            <option v-for="option in SITUATION_OPTIONS" :key="option.value" :value="option.value">{{ option.label }}</option>
          </select>
        </label>
        <label class="filter-field"><span>Cidade</span>
          <input type="text" list="city-options" :value="catalogFilters.city" autocomplete="off" @change="patchFilters({ city: ($event.target as { value: string }).value.trim() })">
          <datalist id="city-options"><option v-for="city in facets?.cities" :key="city" :value="city" /></datalist>
        </label>
        <fieldset class="filter-field filter-options">
          <legend>Modalidade</legend>
          <label v-for="item in facets?.modalities" :key="item" class="filter-check"><input type="checkbox" :checked="catalogFilters.modalities.includes(item)" @change="toggleValue('modalities', item)">{{ item }}</label>
        </fieldset>
        <fieldset class="filter-field filter-options">
          <legend>Tipo de disputa</legend>
          <label v-for="item in facets?.disputeModes" :key="item" class="filter-check"><input type="checkbox" :checked="catalogFilters.disputeModes.includes(item)" @change="toggleValue('disputeModes', item)">{{ item }}</label>
        </fieldset>
        <label class="filter-field"><span>Publicação de</span><input type="date" :value="catalogFilters.publishedFrom" @change="onDate('publishedFrom', $event)"></label>
        <label class="filter-field"><span>Publicação até</span><input type="date" :value="catalogFilters.publishedTo" @change="onDate('publishedTo', $event)"></label>
        <label class="filter-field"><span>Prazo de</span><input type="date" :value="catalogFilters.deadlineFrom" @change="onDate('deadlineFrom', $event)"></label>
        <label class="filter-field"><span>Prazo até</span><input type="date" :value="catalogFilters.deadlineTo" @change="onDate('deadlineTo', $event)"></label>
      </div>
      <div v-if="filterChips.length || !filtersAreDefault" class="filter-chips">
        <span v-for="chip in filterChips" :key="chip.key" class="filter-chip">{{ chip.label }}<button type="button" :aria-label="'Remover filtro ' + chip.label" @click="removeCatalogFilter(chip.key)">×</button></span>
        <button v-if="!filtersAreDefault" type="button" class="btn btn-ghost btn-small" @click="clearCatalogFilters">Limpar filtros</button>
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
