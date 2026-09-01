<script setup lang="ts">
import type { SavedSearch } from '../types';

defineProps<{ radars: SavedSearch[]; limit: number | null; loading?: boolean }>();
const emit = defineEmits<{
  create: [];
  edit: [radar: SavedSearch];
  toggle: [radar: SavedSearch];
  remove: [radar: SavedSearch];
}>();

function date(value: string | null): string {
  return value ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium' }).format(new Date(value)) : 'Ainda não executado';
}
</script>

<template>
  <div class="radar-list" :class="{ 'is-loading': loading }">
    <div class="radar-list-head"><div><span class="section-kicker">Seus filtros salvos</span><h2>Radares salvos</h2></div><button class="btn btn-primary btn-small" type="button" :disabled="limit !== null && radars.length >= limit" @click="emit('create')">+ Novo radar</button></div>
    <div v-if="!radars.length && !loading" class="radar-empty"><span class="radar-empty-icon">⌁</span><div><strong>Crie seu primeiro radar</strong><p>Separe buscas por produto, região ou estratégia comercial.</p></div><button class="btn btn-outline btn-small" type="button" @click="emit('create')">Criar radar</button></div>
    <article v-for="radar in radars" :key="radar.id" class="radar-row">
      <div class="radar-status-dot" :class="{ paused: !radar.enabled }" />
      <div class="radar-row-main"><strong>{{ radar.name }}</strong><span>{{ radar.filters.keywords.slice(0, 3).join(' · ') || 'Todos os termos' }}</span></div>
      <div class="radar-row-meta"><span :class="{ 'radar-paused': !radar.enabled }">{{ radar.enabled ? 'Ativo' : 'Pausado' }}</span><small>Último match: {{ date(radar.lastMatchAt) }}</small></div>
      <div class="radar-row-actions"><button class="text-action" type="button" @click="emit('edit', radar)">{{ radar.enabled ? 'Editar' : 'Ajustar' }}</button><button class="text-action" type="button" @click="emit('toggle', radar)">{{ radar.enabled ? 'Pausar' : 'Ativar' }}</button><button class="text-action danger-action" type="button" @click="emit('remove', radar)">Excluir</button></div>
    </article>
    <small v-if="limit !== null" class="radar-limit">{{ radars.length }} de {{ limit }} radares usados no plano atual.</small>
    <small v-else class="radar-limit">Radares sem limite no plano atual.</small>
  </div>
</template>
