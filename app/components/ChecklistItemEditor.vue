<script setup lang="ts">
import { nextTick, watch } from 'vue';
import type { ChecklistItem, ChecklistPatchInput } from '../types';

const props = defineProps<{
  item: ChecklistItem | null;
  currentUser?: { id: number; name: string } | null;
  saving?: boolean;
}>();

const emit = defineEmits<{
  close: [];
  save: [patch: ChecklistPatchInput];
}>();

const draftTitle = ref('');
const draftDueAt = ref('');
const draftAssignee = ref<'self' | 'none'>('none');
const draftNote = ref('');
const editorCard = ref<{ focus: () => void } | null>(null);

watch(() => props.item, (item) => {
  draftTitle.value = item?.title ?? '';
  draftDueAt.value = toLocalInput(item?.dueAt ?? null);
  draftAssignee.value = item?.assigneeUserId && item.assigneeUserId === props.currentUser?.id ? 'self' : 'none';
  draftNote.value = item?.note ?? '';
  if (item) void nextTick(() => editorCard.value?.focus());
}, { immediate: true });

function submit() {
  emit('save', {
    title: draftTitle.value,
    dueAt: draftDueAt.value ? new Date(draftDueAt.value).toISOString() : null,
    assigneeUserId: draftAssignee.value === 'self' ? props.currentUser?.id ?? null : null,
    note: draftNote.value,
  });
}

function toLocalInput(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  const offsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}
</script>

<template>
  <div v-if="item" class="editor-backdrop" @click.self="emit('close')" @keydown.esc="emit('close')">
    <section ref="editorCard" class="editor-card" role="dialog" aria-modal="true" aria-labelledby="checklist-editor-title" tabindex="-1">
      <div class="editor-head">
        <div>
          <span class="section-kicker">Preparação</span>
          <h3 id="checklist-editor-title">Editar item</h3>
        </div>
        <button class="drawer-close" type="button" aria-label="Fechar editor" @click="emit('close')">×</button>
      </div>

      <label class="field field-wide">
        <span>Título</span>
        <input v-model="draftTitle" type="text" placeholder="Descreva a etapa">
      </label>

      <div class="editor-grid">
        <label class="field">
          <span>Responsável</span>
          <select v-model="draftAssignee">
            <option value="none">Sem responsável</option>
            <option v-if="currentUser" value="self">{{ currentUser.name }}</option>
          </select>
        </label>

        <label class="field">
          <span>Prazo</span>
          <input v-model="draftDueAt" type="datetime-local">
        </label>
      </div>

      <label class="field field-wide">
        <span>Nota</span>
        <textarea v-model="draftNote" rows="4" placeholder="Observações da operação" />
      </label>

      <div class="editor-actions">
        <button class="btn btn-ghost" type="button" @click="emit('close')">Cancelar</button>
        <button class="btn btn-primary" type="button" :disabled="saving || !draftTitle.trim()" @click="submit">
          {{ saving ? 'Salvando…' : 'Salvar alterações' }}
        </button>
      </div>
    </section>
  </div>
</template>
