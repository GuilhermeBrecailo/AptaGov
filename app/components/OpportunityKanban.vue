<script setup lang="ts">
import type { CatalogOpportunity, KanbanState } from '../types';
import { kanbanColumns } from '../types';

defineProps<{ items: CatalogOpportunity[]; loading: boolean }>();
const emit = defineEmits<{ select: [item: CatalogOpportunity]; changeState: [item: CatalogOpportunity, state: KanbanState] }>();

const transitions: Record<KanbanState, KanbanState[]> = {
  NEW: ['QUALIFIED', 'DISCARDED'],
  QUALIFIED: ['CONTACTED', 'DISCARDED'],
  CONTACTED: ['IN_PROGRESS', 'LOST'],
  IN_PROGRESS: ['WON', 'LOST'],
  WON: [],
  LOST: [],
  DISCARDED: [],
};

function byState(items: CatalogOpportunity[], state: KanbanState) {
  return items.filter((item) => item.kanbanState === state);
}

function actionLabel(state: KanbanState) {
  return { QUALIFIED: 'Qualificar', CONTACTED: 'Contatar', IN_PROGRESS: 'Iniciar', WON: 'Ganhar', LOST: 'Perder', DISCARDED: 'Descartar' }[state] ?? state;
}
</script>

<template>
  <div class="kanban-board" :class="{ 'is-loading': loading }">
    <section v-for="column in kanbanColumns" :key="column.state" class="kanban-column">
      <header class="kanban-column-head"><div><span class="column-kicker">{{ column.state }}</span><h3>{{ column.label }}</h3></div><span class="count-badge">{{ byState(items, column.state).length }}</span></header>
      <div v-if="!byState(items, column.state).length" class="column-empty">Arraste seu próximo passo para cá.</div>
      <article v-for="item in byState(items, column.state)" :key="item.id" class="kanban-card" @click="emit('select', item)">
        <span class="score-badge">{{ item.score }}/100</span>
        <h4>{{ item.title }}</h4>
        <p>{{ item.organization }}</p>
        <div class="card-footer"><span>{{ item.state }}</span><button class="icon-button small" aria-label="Ver detalhes" @click.stop="emit('select', item)">↗</button></div>
        <div v-if="transitions[item.kanbanState].length" class="card-transitions" @click.stop>
          <button v-for="next in transitions[item.kanbanState]" :key="next" class="text-action" @click="emit('changeState', item, next)">{{ actionLabel(next) }}</button>
        </div>
      </article>
    </section>
  </div>
</template>
