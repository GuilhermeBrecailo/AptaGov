import { watch, type Ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { getKanbanItems } from '../viewModels/operationalViewModels';
import {
  CATALOG_FILTER_QUERY_KEYS, DEFAULT_CATALOG_FILTERS, filtersFromQuery, filtersToQuery, removeFilterChip,
  type CatalogFilterState,
} from '../viewModels/catalogFiltersViewModel';
import type { CatalogOpportunity, CatalogPage, ChecklistItem, ChecklistPatchInput, FilterConfig, KanbanState, SavedSearch, SyncSettings } from '../types';
import { deadlineInfo } from '../utils/format';

export type CatalogFacets = { modalities: string[]; disputeModes: string[]; cities: string[] };
export type WorkspaceView = 'catalog' | 'kanban';
export type WorkspaceStatus = { pause: { paused: boolean; reason: string | null }; opportunities: number; automaticSync: SyncSettings };

/**
 * Estado e ações do painel (catálogo + kanban).
 * Deve ser chamado de forma síncrona no setup; o chamador aguarda `catalogRequest`.
 */
export function useOpportunityWorkspace(input: {
  filters: Ref<FilterConfig | null | undefined>;
  radarPayload: Ref<{ data: SavedSearch[]; limit: number | null } | null | undefined>;
  status: Ref<WorkspaceStatus | null | undefined>;
  refreshStatus: () => Promise<void>;
}) {
  const route = useRoute();
  const router = useRouter();

  const activeView = ref<WorkspaceView>(route.query.opportunity ? 'kanban' : 'catalog');
  const searchInput = ref('');
  const searchTerm = ref('');
  const stateInput = ref('');
  const selected = ref<CatalogOpportunity | null>(null);
  const selectedRadarId = ref<number | undefined>();
  const sortInput = ref<'score' | 'deadline' | 'publication'>('score');
  const openDeadlineOnly = ref(false);
  const catalogFilters = ref<CatalogFilterState>(filtersFromQuery(route.query));
  const page = ref(1);
  const busy = ref(false);
  const message = ref('');
  const selectedRadar = computed(() => input.radarPayload.value?.data.find((radar) => radar.id === selectedRadarId.value));
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
      minScore: selectedRadar.value?.filters.minimumScore ?? input.filters.value?.minimumScore ?? 0,
      state: stateInput.value || undefined,
      radarId: selectedRadarId.value,
      sort: sortInput.value,
      openDeadlineOnly: openDeadlineOnly.value,
      hideNotRelevant: activeView.value === 'catalog',
      page: page.value,
      pageSize: activeView.value === 'kanban' ? 50 : 20,
      kanbanOnly: activeView.value === 'kanban',
      opportunity: route.query.opportunity,
      // Filtros novos valem só para o catálogo; o kanban continua sem eles.
      ...(activeView.value === 'catalog' ? filtersToQuery(catalogFilters.value) : {}),
    };
  });

  const catalogRequest = useFetch<CatalogPage>('/api/opportunities', {
    query,
    default: () => ({ data: [], total: 0, page: 1, pageSize: 20, totalPages: 1 }),
  });
  const facetsRequest = useFetch<CatalogFacets>('/api/opportunities/facets', {
    query: computed(() => ({ state: stateInput.value || undefined })),
    default: () => ({ modalities: [], disputeModes: [], cities: [] }),
  });
  const facets = facetsRequest.data;
  const { data: catalog, pending: catalogLoading, refresh: refreshCatalog } = catalogRequest;

  const authorizedItems = computed(() => catalog.value?.data ?? []);
  const kanbanItems = computed(() => getKanbanItems(authorizedItems.value));
  const averageScore = computed(() => Math.round(authorizedItems.value.reduce((sum, item) => sum + item.score, 0) / Math.max(1, authorizedItems.value.length)));
  const closingSoonCount = computed(() => authorizedItems.value.filter((item) => {
    const tone = deadlineInfo(item.biddingDeadline)?.tone;
    return tone === 'urgent' || tone === 'soon';
  }).length);

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

  /** Espelha os filtros na URL sem criar histórico e preservando os demais parâmetros. */
  async function syncFiltersToUrl() {
    const preserved = Object.fromEntries(Object.entries(route.query).filter(([key]) => !CATALOG_FILTER_QUERY_KEYS.includes(key)));
    await router.replace({ query: { ...preserved, ...filtersToQuery(catalogFilters.value) } });
  }

  async function setCatalogFilters(next: CatalogFilterState) {
    catalogFilters.value = next;
    page.value = 1;
    await syncFiltersToUrl();
  }

  async function removeCatalogFilter(key: string) {
    await setCatalogFilters(removeFilterChip(catalogFilters.value, key));
  }

  async function clearCatalogFilters() {
    await setCatalogFilters({ ...DEFAULT_CATALOG_FILTERS });
  }

  /** Trocar o estado invalida a cidade escolhida, que pertence às facetas do estado anterior. */
  async function applyStateFilter() {
    if (stateInput.value && catalogFilters.value.city) catalogFilters.value = { ...catalogFilters.value, city: '' };
    page.value = 1;
    await syncFiltersToUrl();
  }

  async function applySearch() {
    searchTerm.value = searchInput.value.trim();
    page.value = 1;
    await refreshCatalog();
  }

  async function selectRadar() {
    page.value = 1;
    await refreshCatalog();
  }

  async function selectView(view: WorkspaceView) {
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
      await Promise.all([refreshCatalog(), input.refreshStatus()]);
    } catch (error) {
      message.value = error instanceof Error ? error.message : 'Sincronização pausada.';
      await input.refreshStatus();
    } finally {
      busy.value = false;
    }
  }

  async function togglePause() {
    if (input.status.value?.pause.paused) await $fetch('/api/worker/resume', { method: 'POST' });
    else await $fetch('/api/worker/pause', { method: 'POST', body: { reason: 'manual_pause' } });
    await input.refreshStatus();
  }

  return {
    catalogRequest,
    activeView,
    searchInput,
    stateInput,
    selected,
    selectedRadarId,
    sortInput,
    openDeadlineOnly,
    page,
    catalogFilters,
    facets,
    busy,
    message,
    checklistByOpportunity,
    checklistLoadingIds,
    checklistSavingIds,
    catalog,
    catalogLoading,
    authorizedItems,
    kanbanItems,
    averageScore,
    closingSoonCount,
    applySearch,
    setCatalogFilters,
    removeCatalogFilter,
    clearCatalogFilters,
    applyStateFilter,
    selectRadar,
    selectView,
    addToKanban,
    updateFeedback,
    changeState,
    completeChecklistItem,
    saveChecklistItem,
    syncNow,
    togglePause,
  };
}
