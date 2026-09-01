<script setup lang="ts">
import type { FilterConfig, SavedSearch } from '../types';

const props = defineProps<{ radar: SavedSearch | null; filters: FilterConfig }>();
const emit = defineEmits<{ save: [payload: { id?: number; name: string; filters: FilterConfig; enabled: boolean; notificationsEnabled: boolean }]; close: [] }>();
const name = ref(props.radar?.name ?? '');
const enabled = ref(props.radar?.enabled ?? true);
const notificationsEnabled = ref(props.radar?.notificationsEnabled ?? true);
const localFilters = ref<FilterConfig>(cloneFilters(props.radar?.filters ?? props.filters));

type ListFilterKey = 'keywords' | 'excludedKeywords' | 'states' | 'citiesIbge' | 'modalities';

function listValue(key: ListFilterKey): string {
  return localFilters.value[key].join(', ');
}

function updateList(key: ListFilterKey, event: Event): void {
  localFilters.value[key] = String((event.target as { value: string }).value)
    .split(/[,.\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function save(): void {
  emit('save', {
    id: props.radar?.id,
    name: name.value,
    filters: localFilters.value,
    enabled: enabled.value,
    notificationsEnabled: notificationsEnabled.value,
  });
}

function cloneFilters(value: FilterConfig): FilterConfig {
  return JSON.parse(JSON.stringify(value)) as FilterConfig;
}
</script>

<template>
  <section class="content-surface radar-editor">
    <div class="list-heading"><div><span class="section-kicker">{{ radar ? 'Editar radar' : 'Novo radar' }}</span><h2>{{ radar ? radar.name : 'Uma busca para cada estratégia' }}</h2></div><button class="close-inline" type="button" aria-label="Fechar editor" @click="emit('close')">×</button></div>
    <div class="radar-editor-grid">
      <label class="field"><span>Nome do radar</span><input v-model="name" required placeholder="Ex.: Software em São Paulo"></label>
      <label class="toggle-field radar-editor-toggle"><input v-model="enabled" type="checkbox"><span>Buscar automaticamente</span></label>
      <label class="toggle-field radar-editor-toggle"><input v-model="notificationsEnabled" type="checkbox"><span>Enviar notificações</span></label>
      <label class="field field-wide"><span>Palavras-chave</span><input :value="listValue('keywords')" placeholder="software, suporte, manutenção" @change="updateList('keywords', $event)"></label>
      <label class="field field-wide"><span>Palavras excluídas</span><input :value="listValue('excludedKeywords')" placeholder="obra, combustível" @change="updateList('excludedKeywords', $event)"></label>
      <label class="field"><span>Estados</span><input :value="listValue('states')" placeholder="SP, PR" @change="updateList('states', $event)"></label>
      <label class="field"><span>Cidades (IBGE)</span><input :value="listValue('citiesIbge')" placeholder="3550308" @change="updateList('citiesIbge', $event)"></label>
      <label class="field"><span>Modalidades</span><input :value="listValue('modalities')" placeholder="6, 8" @change="updateList('modalities', $event)"></label>
      <label class="field"><span>Score mínimo</span><input v-model.number="localFilters.minimumScore" type="number" min="0" max="100"></label>
    </div>
    <div class="radar-editor-actions"><button class="btn btn-ghost" type="button" @click="emit('close')">Cancelar</button><button class="btn btn-dark" type="button" :disabled="!name.trim()" @click="save">Salvar radar</button></div>
  </section>
</template>
