<script setup lang="ts">
import { nextTick, reactive, watch } from 'vue';
import type {
  AgendaEntryView,
  AgendaReminderDraft,
  AgendaVisualType,
  CatalogOpportunity,
  OrganizationAlertPreferences,
  ReminderStatus,
  ReminderType,
} from '../types';

const props = defineProps<{
  entries: AgendaEntryView[];
  opportunities: CatalogOpportunity[];
  preferences: OrganizationAlertPreferences | null;
  range: { from: string; to: string };
  loading?: boolean;
  saving?: boolean;
}>();

const emit = defineEmits<{
  rangeChange: [range: { from: string; to: string }];
  saveReminder: [draft: AgendaReminderDraft];
  updateStatus: [payload: { id: number; status: ReminderStatus }];
  savePreferences: [preferences: Omit<OrganizationAlertPreferences, 'organizationId'>];
}>();

const viewMode = ref<'month' | 'list'>('month');
const opportunityFilter = ref('all');
const typeFilter = ref<'all' | ReminderType>('all');
const statusFilter = ref<'all' | 'OPEN' | 'COMPLETED'>('OPEN');
const rangeFrom = ref(props.range.from);
const rangeTo = ref(props.range.to);
const editorOpen = ref(false);
const reminderEditor = ref<{ focus: () => void } | null>(null);
const preferencesOpen = ref(false);
const draft = ref<AgendaReminderDraft>(emptyDraft());
const preferenceDraft = reactive({
  proposalDeadline: true,
  sessionOpening: true,
  disputeStart: true,
  changeAlerts: true,
});

watch(() => props.range, (range) => {
  rangeFrom.value = range.from;
  rangeTo.value = range.to;
}, { deep: true });

watch(() => props.preferences, (preferences) => {
  if (!preferences) return;
  preferenceDraft.proposalDeadline = preferences.proposalDeadline;
  preferenceDraft.sessionOpening = preferences.sessionOpening;
  preferenceDraft.disputeStart = preferences.disputeStart;
  preferenceDraft.changeAlerts = preferences.changeAlerts;
}, { immediate: true });

watch(editorOpen, (open) => {
  if (open) void nextTick(() => reminderEditor.value?.focus());
});

const filteredEntries = computed(() => props.entries.filter((entry) => {
  if (opportunityFilter.value !== 'all' && entry.opportunityId !== Number(opportunityFilter.value)) return false;
  if (typeFilter.value !== 'all' && entry.reminderType !== typeFilter.value) return false;
  if (statusFilter.value !== 'all' && entry.statusBucket !== statusFilter.value) return false;
  const key = dateKey(entry.occurredAt);
  return key >= rangeFrom.value && key <= rangeTo.value;
}));

const monthLabel = computed(() => new Intl.DateTimeFormat('pt-BR', {
  month: 'long',
  year: 'numeric',
}).format(parseLocalDate(rangeFrom.value)));

const monthDays = computed(() => {
  const monthStart = parseLocalDate(rangeFrom.value);
  const first = new Date(monthStart.getFullYear(), monthStart.getMonth(), 1);
  const gridStart = new Date(first);
  gridStart.setDate(first.getDate() - first.getDay());

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(gridStart);
    date.setDate(gridStart.getDate() + index);
    const key = localDateKey(date);
    return {
      key,
      day: date.getDate(),
      inMonth: date.getMonth() === first.getMonth(),
      isToday: key === localDateKey(new Date()),
      entries: filteredEntries.value.filter((entry) => dateKey(entry.occurredAt) === key),
    };
  });
});

function emptyDraft(): AgendaReminderDraft {
  const dueAt = new Date();
  dueAt.setHours(dueAt.getHours() + 1, 0, 0, 0);
  return {
    opportunityId: props.opportunities[0]?.id ?? null,
    type: 'FOLLOW_UP',
    title: '',
    dueAt: toLocalInput(dueAt.toISOString()),
    note: '',
  };
}

function openCreate() {
  draft.value = emptyDraft();
  editorOpen.value = true;
}

function openEdit(entry: AgendaEntryView) {
  draft.value = {
    id: entry.reminderId,
    opportunityId: entry.opportunityId,
    type: entry.reminderType ?? 'FOLLOW_UP',
    title: entry.title,
    dueAt: toLocalInput(entry.occurredAt),
    note: entry.note ?? '',
  };
  editorOpen.value = true;
}

function submitReminder() {
  if (!draft.value.opportunityId || !draft.value.title.trim() || !draft.value.dueAt) return;
  emit('saveReminder', {
    ...draft.value,
    title: draft.value.title.trim(),
    dueAt: new Date(draft.value.dueAt).toISOString(),
    note: draft.value.note.trim(),
  });
  editorOpen.value = false;
}

function applyRange() {
  if (!rangeFrom.value || !rangeTo.value || rangeFrom.value > rangeTo.value) return;
  emit('rangeChange', { from: rangeFrom.value, to: rangeTo.value });
}

function moveMonth(distance: number) {
  const current = parseLocalDate(rangeFrom.value);
  const target = new Date(current.getFullYear(), current.getMonth() + distance, 1);
  const last = new Date(target.getFullYear(), target.getMonth() + 1, 0);
  rangeFrom.value = localDateKey(target);
  rangeTo.value = localDateKey(last);
  applyRange();
}

function goToday() {
  const today = new Date();
  const first = new Date(today.getFullYear(), today.getMonth(), 1);
  const last = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  rangeFrom.value = localDateKey(first);
  rangeTo.value = localDateKey(last);
  applyRange();
}

function savePreferences() {
  emit('savePreferences', { ...preferenceDraft });
  preferencesOpen.value = false;
}

function visualLabel(type: AgendaVisualType): string {
  return {
    BID_DEADLINE: 'Prazo oficial',
    MEETING: 'Sessão pública',
    DISPUTE: 'Início da disputa',
    RESULT: 'Resultado oficial',
    MANUAL: 'Lembrete manual',
    SOURCE_UPDATE: 'Atualização da fonte',
  }[type];
}

function reminderTypeLabel(type: ReminderType | undefined): string {
  if (!type) return '';
  return {
    BID_DEADLINE: 'Prazo de proposta',
    DOCUMENT_REVIEW: 'Revisão documental',
    FOLLOW_UP: 'Acompanhamento',
    MEETING: 'Sessão ou reunião',
  }[type];
}

function dateTime(value: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function time(value: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function dateKey(value: string): string {
  return localDateKey(new Date(value));
}

function localDateKey(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseLocalDate(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function toLocalInput(value: string): string {
  const date = new Date(value);
  const offsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}
</script>

<template>
  <section class="agenda-workbench" aria-labelledby="agenda-title">
    <header class="agenda-command-bar">
      <div>
        <span class="section-kicker">Mesa operacional de prazos</span>
        <h2 id="agenda-title">Agenda</h2>
        <p>Reúna prazos oficiais, sessões e lembretes da equipe em uma única linha do tempo.</p>
      </div>
      <div class="agenda-command-actions">
        <button class="btn btn-ghost" type="button" @click="preferencesOpen = !preferencesOpen">Preferências</button>
        <button class="btn btn-primary" type="button" @click="openCreate">Criar lembrete</button>
      </div>
    </header>

    <form class="agenda-filters" aria-label="Filtros da agenda" @submit.prevent="applyRange">
      <label>
        <span>Oportunidade</span>
        <select v-model="opportunityFilter">
          <option value="all">Todas as oportunidades</option>
          <option v-for="opportunity in opportunities" :key="opportunity.id" :value="String(opportunity.id)">{{ opportunity.title }}</option>
        </select>
      </label>
      <label>
        <span>Tipo de lembrete</span>
        <select v-model="typeFilter">
          <option value="all">Todos os tipos</option>
          <option value="BID_DEADLINE">Prazo de proposta</option>
          <option value="DOCUMENT_REVIEW">Revisão documental</option>
          <option value="FOLLOW_UP">Acompanhamento</option>
          <option value="MEETING">Sessão ou reunião</option>
        </select>
      </label>
      <label>
        <span>Situação</span>
        <select v-model="statusFilter">
          <option value="all">Abertos e concluídos</option>
          <option value="OPEN">Em aberto</option>
          <option value="COMPLETED">Concluídos</option>
        </select>
      </label>
      <label>
        <span>De</span>
        <input v-model="rangeFrom" type="date">
      </label>
      <label>
        <span>Até</span>
        <input v-model="rangeTo" type="date">
      </label>
      <button class="btn btn-dark" type="submit">Aplicar período</button>
    </form>

    <section v-if="preferencesOpen" class="agenda-preferences" aria-label="Preferências da agenda">
      <div>
        <span class="section-kicker">Alertas oficiais</span>
        <h3>O que entra na sua mesa</h3>
      </div>
      <label><input v-model="preferenceDraft.proposalDeadline" type="checkbox"> Prazos de proposta</label>
      <label><input v-model="preferenceDraft.sessionOpening" type="checkbox"> Aberturas de sessão</label>
      <label><input v-model="preferenceDraft.disputeStart" type="checkbox"> Inícios de disputa</label>
      <label><input v-model="preferenceDraft.changeAlerts" type="checkbox"> Mudanças na fonte oficial</label>
      <button class="btn btn-outline" type="button" :disabled="saving" @click="savePreferences">Salvar preferências</button>
    </section>

    <div class="agenda-view-bar">
      <div class="agenda-period-navigation">
        <button class="icon-button" type="button" aria-label="Mês anterior" @click="moveMonth(-1)">←</button>
        <button class="agenda-today" type="button" @click="goToday">Hoje</button>
        <button class="icon-button" type="button" aria-label="Próximo mês" @click="moveMonth(1)">→</button>
        <strong>{{ monthLabel }}</strong>
      </div>
      <div class="view-tabs agenda-view-tabs" aria-label="Modo de visualização">
        <button type="button" :class="{ active: viewMode === 'month' }" @click="viewMode = 'month'">Visão mensal</button>
        <button type="button" :class="{ active: viewMode === 'list' }" @click="viewMode = 'list'">Visão em lista</button>
      </div>
    </div>

    <div v-if="loading" class="agenda-empty">Carregando agenda…</div>
    <div v-else-if="!filteredEntries.length" class="agenda-empty">
      <strong>Nenhum compromisso neste recorte.</strong>
      <span>Ajuste os filtros ou crie um lembrete para a equipe.</span>
    </div>

    <div v-else-if="viewMode === 'month'" class="agenda-month" aria-label="Visão mensal da agenda">
      <span v-for="weekday in ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']" :key="weekday" class="agenda-weekday">{{ weekday }}</span>
      <div v-for="day in monthDays" :key="day.key" class="agenda-day" :class="{ muted: !day.inMonth, today: day.isToday }">
        <span class="agenda-day-number">{{ day.day }}</span>
        <article
          v-for="entry in day.entries.slice(0, 3)"
          :key="entry.id"
          class="agenda-event agenda-event-compact"
          :class="`type-${entry.visualType.toLowerCase().replace('_', '-')}`"
        >
          <span>{{ time(entry.occurredAt) }}</span>
          <strong>{{ entry.title }}</strong>
        </article>
        <button v-if="day.entries.length > 3" class="agenda-more" type="button" @click="viewMode = 'list'">+ {{ day.entries.length - 3 }} itens</button>
      </div>
    </div>

    <div v-else class="agenda-list" aria-label="Visão em lista da agenda">
      <article
        v-for="entry in filteredEntries"
        :key="entry.id"
        class="agenda-event"
        :class="[`type-${entry.visualType.toLowerCase().replace('_', '-')}`, { completed: entry.statusBucket === 'COMPLETED' }]"
      >
        <time :datetime="entry.occurredAt"><strong>{{ dateTime(entry.occurredAt) }}</strong><span>{{ entry.statusLabel }}</span></time>
        <div class="agenda-event-main">
          <div class="agenda-event-labels">
            <span>{{ visualLabel(entry.visualType) }}</span>
            <span v-if="entry.reminderType">{{ reminderTypeLabel(entry.reminderType) }}</span>
          </div>
          <h3>{{ entry.title }}</h3>
          <p>{{ entry.opportunityTitle }}</p>
          <small v-if="entry.note">{{ entry.note }}</small>
        </div>
        <div class="agenda-event-source">
          <span>{{ entry.sourceLabel }}</span>
          <a :href="entry.sourceUrl" target="_blank" rel="noreferrer">Abrir fonte oficial ↗</a>
          <NuxtLink :to="{ path: '/', query: { opportunity: entry.opportunityId } }">Ver oportunidade</NuxtLink>
        </div>
        <div v-if="entry.kind === 'REMINDER'" class="agenda-event-actions">
          <button v-if="entry.canEdit" class="text-action" type="button" @click="openEdit(entry)">Editar lembrete</button>
          <button v-if="entry.canComplete" class="text-action" type="button" :disabled="saving" @click="emit('updateStatus', { id: entry.reminderId!, status: 'COMPLETED' })">Concluir</button>
          <button v-if="entry.canSkip" class="text-action muted-action" type="button" :disabled="saving" @click="emit('updateStatus', { id: entry.reminderId!, status: 'SKIPPED' })">Pular</button>
        </div>
      </article>
    </div>

    <div v-if="editorOpen" class="editor-backdrop" @click.self="editorOpen = false" @keydown.esc="editorOpen = false">
      <section ref="reminderEditor" class="editor-card agenda-editor" role="dialog" aria-modal="true" aria-labelledby="reminder-editor-title" tabindex="-1">
        <div class="editor-head">
          <div>
            <span class="section-kicker">Agenda</span>
            <h3 id="reminder-editor-title">{{ draft.id ? 'Editar lembrete' : 'Criar lembrete' }}</h3>
          </div>
          <button class="drawer-close" type="button" aria-label="Fechar editor" @click="editorOpen = false">×</button>
        </div>
        <label class="field field-wide">
          <span>Oportunidade</span>
          <select v-model.number="draft.opportunityId" :disabled="Boolean(draft.id)">
            <option :value="null" disabled>Selecione uma oportunidade</option>
            <option v-for="opportunity in opportunities" :key="opportunity.id" :value="opportunity.id">{{ opportunity.title }}</option>
          </select>
        </label>
        <div class="editor-grid">
          <label class="field">
            <span>Tipo de lembrete</span>
            <select v-model="draft.type" :disabled="Boolean(draft.id)">
              <option value="FOLLOW_UP">Acompanhamento</option>
              <option value="DOCUMENT_REVIEW">Revisão documental</option>
              <option value="MEETING">Sessão ou reunião</option>
              <option value="BID_DEADLINE">Prazo de proposta</option>
            </select>
          </label>
          <label class="field">
            <span>Data e hora</span>
            <input v-model="draft.dueAt" type="datetime-local">
          </label>
        </div>
        <label class="field field-wide">
          <span>Título</span>
          <input v-model="draft.title" type="text" placeholder="Ex.: revisar documentação fiscal">
        </label>
        <label class="field field-wide">
          <span>Nota</span>
          <textarea v-model="draft.note" rows="3" placeholder="Contexto útil para quem assumir esta etapa" />
        </label>
        <div class="editor-actions">
          <button class="btn btn-ghost" type="button" @click="editorOpen = false">Cancelar</button>
          <button class="btn btn-primary" type="button" :disabled="saving || !draft.opportunityId || !draft.title.trim() || !draft.dueAt" @click="submitReminder">
            {{ saving ? 'Salvando…' : draft.id ? 'Salvar alterações' : 'Criar lembrete' }}
          </button>
        </div>
      </section>
    </div>
  </section>
</template>
