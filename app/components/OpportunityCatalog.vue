<script setup lang="ts">
import type { CatalogOpportunity } from '../types';
import { deadlineInfo, formatDate, formatMoney, scoreTone } from '../utils/format';

defineProps<{ items: CatalogOpportunity[]; loading: boolean }>();
const emit = defineEmits<{ select: [item: CatalogOpportunity]; add: [item: CatalogOpportunity]; feedback: [item: CatalogOpportunity, status: 'FAVORITED' | 'NOT_RELEVANT' | null] }>();
</script>

<template>
  <div class="catalog-list" :class="{ 'is-loading': loading }" :aria-busy="loading">
    <div v-if="!items.length && !loading" class="empty-state">
      <strong>Nenhuma licitação encontrada</strong>
      <p>Mude a pesquisa ou os filtros acima.</p>
    </div>
    <article v-for="item in items" :key="item.id" class="opportunity-row" @click="emit('select', item)">
      <span class="row-score" :class="`tone-${scoreTone(item.score)}`" :title="`Aderência ${item.score} de 100`">{{ item.score }}</span>
      <div class="row-main">
        <h3>{{ item.title }}</h3>
        <p>{{ item.organization }} · {{ item.city ? `${item.city}/` : '' }}{{ item.state }}</p>
      </div>
      <div class="row-meta">
        <strong v-if="item.estimatedValueCents">{{ formatMoney(item.estimatedValueCents) }}</strong>
        <span :class="`deadline-${deadlineInfo(item.biddingDeadline)?.tone ?? 'normal'}`">{{ item.biddingDeadline ? formatDate(item.biddingDeadline) : 'Sem prazo' }}<template v-if="deadlineInfo(item.biddingDeadline) && deadlineInfo(item.biddingDeadline)?.tone !== 'normal'"> · {{ deadlineInfo(item.biddingDeadline)?.label }}</template></span>
      </div>
      <div class="row-actions" @click.stop>
        <span v-if="item.inKanban" class="saved-label">No kanban</span>
        <button v-else class="btn btn-ghost btn-small" type="button" aria-label="Adicionar ao kanban" @click="emit('add', item)">+ Kanban</button>
        <button class="row-icon" type="button" :class="{ selected: item.favorite }" :aria-pressed="item.favorite" :aria-label="item.favorite ? 'Remover dos favoritos' : 'Favoritar'" :title="item.favorite ? 'Remover dos favoritos' : 'Favoritar'" @click="emit('feedback', item, item.favorite ? null : 'FAVORITED')">{{ item.favorite ? '★' : '☆' }}</button>
        <button class="row-icon" type="button" :aria-label="item.notRelevant ? 'Mostrar novamente' : 'Não interessa'" :title="item.notRelevant ? 'Mostrar novamente' : 'Não interessa'" @click="emit('feedback', item, item.notRelevant ? null : 'NOT_RELEVANT')">✕</button>
      </div>
    </article>
  </div>
</template>
