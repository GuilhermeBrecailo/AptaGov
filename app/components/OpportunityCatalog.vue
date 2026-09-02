<script setup lang="ts">
import type { CatalogOpportunity } from '../types';

defineProps<{ items: CatalogOpportunity[]; loading: boolean }>();
const emit = defineEmits<{ select: [item: CatalogOpportunity]; add: [item: CatalogOpportunity]; feedback: [item: CatalogOpportunity, status: 'FAVORITED' | 'NOT_RELEVANT' | null] }>();

function money(cents: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(cents / 100);
}

function date(value: string | null) {
  return value ? new Intl.DateTimeFormat('pt-BR').format(new Date(value)) : 'Sem prazo informado';
}

</script>

<template>
  <div class="catalog-list" :class="{ 'is-loading': loading }">
    <div v-if="!items.length && !loading" class="empty-state">
      <span class="empty-icon">⌕</span>
      <strong>Nenhuma licitação encontrada</strong>
      <p>Tente mudar a busca ou reduzir o score mínimo.</p>
    </div>
    <article v-for="item in items" :key="item.id" class="opportunity-row" @click="emit('select', item)">
      <div class="row-main">
        <div class="row-badges"><span class="score-badge">{{ item.score }}/100</span><span class="source-badge">{{ item.sourceLabel }}</span></div>
        <h3>{{ item.title }}</h3>
        <p>{{ item.organization }} <span>·</span> {{ item.state }}{{ item.city ? ` · ${item.city}` : '' }}</p>
      </div>
      <div class="row-meta">
        <span><small>Prazo</small>{{ date(item.biddingDeadline) }}</span>
        <span v-if="item.estimatedValueCents"><small>Valor estimado</small>{{ money(item.estimatedValueCents) }}</span>
      </div>
      <div class="row-actions" @click.stop>
        <button v-if="!item.inKanban" class="btn btn-primary btn-small" @click="emit('add', item)">Adicionar ao kanban</button>
        <span v-else class="saved-label">No kanban</span>
        <button class="text-action catalog-feedback-action" type="button" :class="{ selected: item.favorite }" :aria-label="item.favorite ? 'Remover dos favoritos' : 'Favoritar'" @click="emit('feedback', item, item.favorite ? null : 'FAVORITED')">{{ item.favorite ? 'Favoritada' : 'Favoritar' }}</button>
        <button class="text-action catalog-feedback-action muted-action" type="button" @click="emit('feedback', item, item.notRelevant ? null : 'NOT_RELEVANT')">{{ item.notRelevant ? 'Desfazer' : 'Não interessa' }}</button>
        <button class="icon-button" aria-label="Ver detalhes" title="Ver detalhes" @click="emit('select', item)">→</button>
      </div>
    </article>
  </div>
</template>
