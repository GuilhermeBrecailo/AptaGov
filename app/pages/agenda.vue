<script setup lang="ts">
import { watch } from 'vue';
import AgendaView from '../components/AgendaView.vue';
import type {
  AgendaEntryView,
  AgendaReminderDraft,
  AgendaVisualType,
  AuthPayload,
  CatalogOpportunity,
  CatalogPage,
  OpportunityChangeEvent,
  OpportunityReminder,
  OrganizationAlertPreferences,
  ReminderStatus,
  ReminderType,
} from '../types';

const { data: auth, error: authError } = await useFetch<AuthPayload>('/api/auth/me');
if (authError.value) await navigateTo('/login');

const range = ref(currentMonthRange());
const saving = ref(false);
const message = ref('');
const agendaQuery = computed(() => ({
  from: rangeBoundary(range.value.from, false),
  to: rangeBoundary(range.value.to, true),
}));

const { data: reminders, pending: agendaLoading, refresh: refreshAgenda } = await useFetch<OpportunityReminder[]>('/api/agenda', {
  query: agendaQuery,
  default: () => [],
});
const { data: preferences, refresh: refreshPreferences } = await useFetch<OrganizationAlertPreferences>('/api/agenda-preferences');
const { data: opportunityPage } = await useFetch<CatalogPage>('/api/opportunities', {
  query: { kanbanOnly: true, pageSize: 50, sort: 'deadline' },
  default: () => ({ data: [], total: 0, page: 1, pageSize: 50, totalPages: 1 }),
});

const opportunities = computed(() => opportunityPage.value?.data ?? []);
const changes = ref<OpportunityChangeEvent[]>([]);

await loadChanges(opportunities.value);
watch(opportunities, (items) => void loadChanges(items));

const entries = computed<AgendaEntryView[]>(() => {
  const opportunityById = new Map(opportunities.value.map((opportunity) => [opportunity.id, opportunity]));
  const reminderEntries = (reminders.value ?? []).flatMap((reminder) => {
    const opportunity = opportunityById.get(reminder.opportunityId);
    return opportunity ? [reminderEntry(reminder, opportunity)] : [];
  });
  const changeEntries = changes.value.flatMap((change) => {
    const opportunity = opportunityById.get(change.opportunityId);
    return opportunity ? [changeEntry(change, opportunity)] : [];
  });
  return [...reminderEntries, ...changeEntries]
    .sort((left, right) => new Date(left.occurredAt).getTime() - new Date(right.occurredAt).getTime());
});

async function loadChanges(items: CatalogOpportunity[]) {
  changes.value = (await Promise.all(items.map((opportunity) => (
    $fetch<OpportunityChangeEvent[]>(`/api/opportunities/${opportunity.id}/changes`)
  )))).flat();
}

async function saveReminder(draft: AgendaReminderDraft) {
  saving.value = true;
  message.value = '';
  try {
    if (draft.id) {
      await $fetch(`/api/agenda/${draft.id}`, {
        method: 'PATCH',
        body: { title: draft.title, dueAt: draft.dueAt, note: draft.note },
      });
      message.value = 'Lembrete atualizado.';
    } else {
      await $fetch('/api/agenda', { method: 'POST', body: draft });
      message.value = 'Lembrete criado.';
    }
    await refreshAgenda();
  } catch (error) {
    message.value = error instanceof Error ? error.message : 'Não foi possível salvar o lembrete.';
  } finally {
    saving.value = false;
  }
}

async function updateStatus(payload: { id: number; status: ReminderStatus }) {
  saving.value = true;
  try {
    await $fetch(`/api/agenda/${payload.id}`, { method: 'PATCH', body: { status: payload.status } });
    message.value = payload.status === 'COMPLETED' ? 'Lembrete concluído.' : 'Lembrete pulado.';
    await refreshAgenda();
  } finally {
    saving.value = false;
  }
}

async function savePreferences(next: Omit<OrganizationAlertPreferences, 'organizationId'>) {
  saving.value = true;
  try {
    await $fetch('/api/agenda-preferences', { method: 'PUT', body: next });
    message.value = 'Preferências da agenda salvas.';
    await refreshPreferences();
  } finally {
    saving.value = false;
  }
}

async function logout() {
  await $fetch('/api/auth/logout', { method: 'POST' });
  await navigateTo('/login');
}

function reminderEntry(reminder: OpportunityReminder, opportunity: CatalogOpportunity): AgendaEntryView {
  const pending = reminder.status === 'PENDING';
  return {
    id: `reminder-${reminder.id}`,
    opportunityId: reminder.opportunityId,
    reminderId: reminder.id,
    reminderType: reminder.type,
    kind: 'REMINDER',
    visualType: reminder.createdByUserId === null ? reminderVisualType(reminder.type) : 'MANUAL',
    title: reminder.title,
    subtitle: reminder.type,
    occurredAt: reminder.dueAt,
    sourceLabel: reminder.createdByUserId === null ? sourceLabel(opportunity) : 'Lembrete manual',
    sourceUrl: opportunity.sourceUrl,
    opportunityTitle: opportunity.title,
    statusBucket: pending ? 'OPEN' : 'COMPLETED',
    statusLabel: reminder.status === 'PENDING' ? 'Em aberto' : reminder.status === 'COMPLETED' ? 'Concluído' : 'Pulado',
    note: reminder.note,
    canEdit: true,
    canComplete: pending,
    canSkip: pending,
  };
}

function changeEntry(change: OpportunityChangeEvent, opportunity: CatalogOpportunity): AgendaEntryView {
  return {
    id: `change-${change.id}`,
    opportunityId: change.opportunityId,
    changeId: change.id,
    kind: 'CHANGE',
    visualType: changeVisualType(change.type),
    title: change.summary,
    subtitle: change.type,
    occurredAt: change.detectedAt,
    sourceLabel: sourceLabel(opportunity),
    sourceUrl: opportunity.sourceUrl,
    opportunityTitle: opportunity.title,
    statusBucket: change.readAt ? 'COMPLETED' : 'OPEN',
    statusLabel: change.readAt ? 'Lida' : 'Mudança oficial',
    note: null,
    canEdit: false,
    canComplete: false,
    canSkip: false,
    readAt: change.readAt,
  };
}

function reminderVisualType(type: ReminderType): AgendaVisualType {
  if (type === 'BID_DEADLINE') return 'BID_DEADLINE';
  if (type === 'MEETING') return 'MEETING';
  return 'MANUAL';
}

function changeVisualType(type: OpportunityChangeEvent['type']): AgendaVisualType {
  return {
    PROPOSAL_DEADLINE: 'BID_DEADLINE',
    SESSION_OPENING: 'MEETING',
    DISPUTE_START: 'DISPUTE',
    CLOSING_RESULT: 'RESULT',
    SOURCE_UPDATE: 'SOURCE_UPDATE',
  }[type] as AgendaVisualType;
}

function sourceLabel(opportunity: CatalogOpportunity): string {
  return opportunity.source === 'PNCP' ? 'Fonte oficial · PNCP' : 'Fonte oficial · Dados abertos';
}

function currentMonthRange() {
  const today = new Date();
  return {
    from: localDateKey(new Date(today.getFullYear(), today.getMonth(), 1)),
    to: localDateKey(new Date(today.getFullYear(), today.getMonth() + 1, 0)),
  };
}

function localDateKey(value: Date): string {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
}

function rangeBoundary(value: string, end: boolean): string {
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day, end ? 23 : 0, end ? 59 : 0, end ? 59 : 0, end ? 999 : 0);
  return date.toISOString();
}
</script>

<template>
  <div class="product-shell">
    <header class="app-topbar">
      <div class="topbar-brand-area">
        <AppNavDrawer :auth="auth" active="agenda" @logout="logout" />
        <div class="brand-lockup"><div class="brand-mark">A</div><div><span class="brand-name">AptaGov</span><span class="brand-caption">Inteligência para vender ao governo</span></div></div>
      </div>
      <div class="account-area"><div class="organization-chip"><span class="org-avatar">{{ auth?.organization.name.slice(0, 1).toUpperCase() }}</span><span>{{ auth?.organization.name }}</span></div><span class="user-name">{{ auth?.user.name }}</span><button class="topbar-action" type="button" @click="logout">Sair</button></div>
    </header>

    <main class="app-content agenda-page">
      <div class="app-heading">
        <div><span class="section-kicker">Operação de mercado</span><h1>Agenda operacional</h1><p>Veja o que vence, o que mudou e o que a equipe precisa preparar.</p></div>
      </div>
      <div v-if="message" class="notice" role="status">{{ message }}</div>
      <AgendaView
        :entries="entries"
        :opportunities="opportunities"
        :preferences="preferences ?? null"
        :range="range"
        :loading="agendaLoading"
        :saving="saving"
        @range-change="range = $event"
        @save-reminder="saveReminder"
        @update-status="updateStatus"
        @save-preferences="savePreferences"
      />
    </main>
  </div>
</template>
