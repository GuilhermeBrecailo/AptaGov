<script setup lang="ts">
import { onMounted, watch } from 'vue';
import ChecklistItemEditor from './ChecklistItemEditor.vue';
import type { ChecklistItem, ChecklistPatchInput } from '../types';
import { buildChecklistPresentation } from '../viewModels/operationalViewModels';

const props = withDefaults(defineProps<{
  items: ChecklistItem[];
  loading?: boolean;
  compact?: boolean;
  currentUser?: { id: number; name: string } | null;
  saving?: boolean;
}>(), {
  loading: false,
  compact: false,
  currentUser: null,
  saving: false,
});

const emit = defineEmits<{
  quickComplete: [itemId: number];
  saveItem: [payload: { id: number; patch: ChecklistPatchInput }];
}>();

const collapsed = ref(props.compact);
const editingItem = ref<ChecklistItem | null>(null);
const listId = computed(() => `preparation-items-${props.items[0]?.opportunityId ?? 'empty'}-${props.compact ? 'compact' : 'detail'}`);

watch(() => props.compact, (value) => {
  collapsed.value = value;
}, { immediate: true });

onMounted(() => {
  if (globalThis.matchMedia?.('(max-width: 700px)').matches) collapsed.value = true;
});

const checklistPresentation = computed(() => buildChecklistPresentation(props.items));

function assigneeLabel(item: ChecklistItem | null): string {
  if (!item?.assigneeUserId) return 'Sem responsável';
  if (item.assigneeUserId === props.currentUser?.id) return props.currentUser.name;
  return `Responsável #${item.assigneeUserId}`;
}

function dateTime(value: string | null): string {
  if (!value) return 'Sem prazo';
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function statusLabel(status: ChecklistItem['status']): string {
  return {
    OPEN: 'Aberto',
    COMPLETED: 'Concluído',
    SKIPPED: 'Pulado',
  }[status];
}

function categoryLabel(category: ChecklistItem['category']): string {
  return {
    DOCUMENTS: 'Documentos',
    COMMERCIAL: 'Comercial',
    PROPOSAL: 'Proposta',
    SESSION: 'Sessão',
    REVIEW: 'Revisão',
  }[category];
}

function saveItem(patch: ChecklistPatchInput) {
  if (!editingItem.value) return;
  emit('saveItem', { id: editingItem.value.id, patch });
  editingItem.value = null;
}
</script>

<template>
  <section class="preparation-block" :class="{ compact }">
    <header class="preparation-header">
      <div>
        <span class="section-kicker">Preparação</span>
        <h3>Preparação</h3>
      </div>
      <button class="btn btn-ghost btn-small preparation-toggle" type="button" :aria-expanded="!collapsed" :aria-controls="listId" @click="collapsed = !collapsed">
        {{ collapsed ? 'Abrir checklist' : 'Recolher checklist' }}
      </button>
    </header>

    <div class="preparation-summary">
      <div>
        <small>Progresso</small>
        <strong>{{ checklistPresentation.progressValue }}%</strong>
        <span>{{ checklistPresentation.completedItems.length }}/{{ checklistPresentation.orderedItems.length }} concluídos</span>
        <progress :value="checklistPresentation.completedItems.length" :max="Math.max(checklistPresentation.orderedItems.length, 1)" aria-label="Progresso da preparação" />
      </div>
      <div>
        <small>Urgentes</small>
        <strong>{{ checklistPresentation.urgentItems.length }}</strong>
        <span>{{ checklistPresentation.urgentItems.length === 1 ? 'item perto do prazo' : 'itens perto do prazo' }}</span>
      </div>
      <div>
        <small>Prazo</small>
        <strong>{{ dateTime(checklistPresentation.nextOpenItem?.dueAt ?? null) }}</strong>
        <span>{{ checklistPresentation.nextOpenItem?.title ?? 'Sem prazo' }}</span>
      </div>
      <div>
        <small>Responsável</small>
        <strong>{{ assigneeLabel(checklistPresentation.nextOpenItem) }}</strong>
        <span>{{ checklistPresentation.nextOpenItem ? categoryLabel(checklistPresentation.nextOpenItem.category) : 'Sem responsável' }}</span>
      </div>
      <button
        v-if="checklistPresentation.nextOpenItem"
        class="btn btn-outline btn-small"
        type="button"
        :disabled="saving"
        @click="emit('quickComplete', checklistPresentation.nextOpenItem.id)"
      >
        Concluir item
      </button>
    </div>

    <div v-if="loading" class="preparation-empty">Carregando checklist…</div>
    <div v-else-if="!checklistPresentation.orderedItems.length" class="preparation-empty">Adicione a licitação ao kanban para abrir a preparação.</div>
    <div v-else-if="!collapsed" :id="listId" class="preparation-items">
      <article
        v-for="checklistItem in checklistPresentation.orderedItems"
        :key="checklistItem.id"
        class="preparation-item"
        :class="[
          checklistItem.status === 'COMPLETED' ? 'is-completed' : '',
          checklistItem.status === 'SKIPPED' ? 'is-skipped' : '',
          checklistItem.dueAt ? 'has-deadline' : '',
        ]"
      >
        <div class="preparation-item-main">
          <div class="preparation-item-meta">
            <span class="preparation-item-category">{{ categoryLabel(checklistItem.category) }}</span>
            <span class="preparation-item-status">{{ statusLabel(checklistItem.status) }}</span>
          </div>
          <strong>{{ checklistItem.title }}</strong>
          <p>{{ assigneeLabel(checklistItem) }} · {{ dateTime(checklistItem.dueAt) }}</p>
          <small v-if="checklistItem.note">{{ checklistItem.note }}</small>
        </div>

        <div class="preparation-item-actions">
          <button class="text-action" type="button" @click="editingItem = checklistItem">Editar</button>
          <button
            v-if="checklistItem.status === 'OPEN'"
            class="text-action"
            type="button"
            :disabled="saving"
            @click="emit('quickComplete', checklistItem.id)"
          >
            Concluir
          </button>
        </div>
      </article>
    </div>

    <ChecklistItemEditor
      :item="editingItem"
      :current-user="currentUser"
      :saving="saving"
      @close="editingItem = null"
      @save="saveItem"
    />
  </section>
</template>
