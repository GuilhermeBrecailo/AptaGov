<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import type { CheckStatus, EditalAnalysisView, LotVerdict, RequirementCheck } from '../types';

const props = defineProps<{ opportunityId: number; sourceUrl?: string }>();

const POLL_MS = 5000;
const view = ref<EditalAnalysisView | null>(null);
const loading = ref(false);
const starting = ref(false);
const error = ref('');
const lotIndex = ref(0);
const agendaState = ref<Record<string, 'saving' | 'done' | 'error'>>({});
let request = 0;
let timer: ReturnType<typeof globalThis.setTimeout> | undefined;

const verdictLabel: Record<LotVerdict['verdict'], string> = { APT: 'Apto', NOT_APT: 'Não apto', CHECK: 'Verificar' };
const statusIcon: Record<CheckStatus, string> = { fail: '❌', check: '⚠️', ok: '✅' };
const statusText: Record<CheckStatus, string> = { fail: 'Não atende', check: 'Verificar', ok: 'Atende' };
const statusOrder: Record<CheckStatus, number> = { fail: 0, check: 1, ok: 2 };

const running = computed(() => view.value?.analysis?.status === 'RUNNING');
const completed = computed(() => view.value?.analysis?.status === 'COMPLETED');
const failed = computed(() => view.value?.analysis?.status === 'FAILED');
const lots = computed(() => view.value?.lots ?? []);
const lot = computed<LotVerdict | null>(() => lots.value[lotIndex.value] ?? lots.value[0] ?? null);
const checks = computed<RequirementCheck[]>(() =>
  [...(lot.value?.checks ?? [])].sort((a, b) => statusOrder[a.status] - statusOrder[b.status]));
const busy = computed(() => starting.value || running.value);

function getApiError(err: unknown, fallback: string) {
  if (err && typeof err === 'object' && 'data' in err) {
    const data = err.data;
    if (data && typeof data === 'object' && 'statusMessage' in data && typeof data.statusMessage === 'string') return data.statusMessage;
  }
  return fallback;
}

function clearTimer() {
  if (timer) globalThis.clearTimeout(timer);
  timer = undefined;
}

function apply(next: EditalAnalysisView, id: number) {
  view.value = next;
  if (lotIndex.value >= next.lots.length) lotIndex.value = 0;
  clearTimer();
  if (next.analysis?.status === 'RUNNING') timer = globalThis.setTimeout(() => void load(id, true), POLL_MS);
}

async function load(id: number, silent = false) {
  const current = ++request;
  if (!silent) loading.value = true;
  try {
    const next = await $fetch<EditalAnalysisView>(`/api/opportunities/${id}/edital-analysis`);
    if (current === request) { error.value = ''; apply(next, id); }
  } catch (err) {
    if (current === request) {
      error.value = getApiError(err, 'Não foi possível carregar a análise do edital');
      // Falha ao consultar durante a leitura: tenta de novo em vez de travar no "lendo".
      if (silent && running.value) timer = globalThis.setTimeout(() => void load(id, true), POLL_MS);
    }
  } finally {
    if (current === request) loading.value = false;
  }
}

async function start() {
  const id = props.opportunityId;
  const current = ++request;
  starting.value = true;
  error.value = '';
  try {
    const next = await $fetch<EditalAnalysisView>(`/api/opportunities/${id}/edital-analysis`, { method: 'POST' });
    if (current === request) apply(next, id);
  } catch (err) {
    if (current === request) error.value = getApiError(err, 'Não foi possível iniciar a análise');
  } finally {
    if (current === request) starting.value = false;
  }
}

function visitDue(check: RequirementCheck): string | null {
  return check.category === 'technical_visit' && check.deadline && !Number.isNaN(Date.parse(check.deadline))
    ? new Date(check.deadline).toISOString()
    : null;
}

async function addVisit(check: RequirementCheck) {
  const dueAt = visitDue(check);
  if (!dueAt) return;
  agendaState.value = { ...agendaState.value, [check.requirementId]: 'saving' };
  try {
    await $fetch('/api/agenda', {
      method: 'POST',
      body: { opportunityId: props.opportunityId, type: 'MEETING', title: 'Visita técnica', dueAt },
    });
    agendaState.value = { ...agendaState.value, [check.requirementId]: 'done' };
  } catch {
    agendaState.value = { ...agendaState.value, [check.requirementId]: 'error' };
  }
}

watch(() => props.opportunityId, (id) => {
  clearTimer();
  request += 1;
  view.value = null;
  error.value = '';
  lotIndex.value = 0;
  agendaState.value = {};
  starting.value = false;
  if (id) void load(id);
}, { immediate: true });

onBeforeUnmount(() => { clearTimer(); request += 1; });
</script>

<template>
  <section class="details-section edital-panel" aria-label="Análise do edital">
    <div class="edital-head">
      <h3>Análise do edital</h3>
      <button
        v-if="view"
        class="btn btn-primary btn-small"
        type="button"
        :disabled="!view.enabled || busy"
        :title="view.disabledReason ?? undefined"
        @click="start"
      >Analisar edital</button>
    </div>

    <p v-if="view && !view.enabled && view.disabledReason" class="edital-muted">{{ view.disabledReason }}</p>
    <p v-if="loading && !view" class="edital-muted">Carregando…</p>
    <p v-if="error" class="form-error" role="alert">{{ error }}</p>

    <p v-if="running" class="edital-muted" role="status">Lendo o edital… (pode levar até 3 minutos)</p>

    <div v-if="failed" class="form-error" role="alert">
      {{ view?.analysis?.error || 'Falha ao analisar o edital.' }}
      <a v-if="sourceUrl" :href="sourceUrl" target="_blank" rel="noreferrer">Abrir na fonte oficial ↗</a>
    </div>

    <template v-if="view && !running">
      <div v-if="view.profileEmpty && view.enabled" class="notice warning">
        <span>Preencha seu perfil técnico para comparar com o edital.</span>
        <NuxtLink class="text-action" to="/perfil">Preencher perfil técnico</NuxtLink>
      </div>

      <div v-if="completed && view.profileChanged" class="notice warning">
        <span>Seu perfil mudou desde esta análise</span>
        <button class="btn btn-small btn-ghost" type="button" :disabled="busy || !view.enabled" @click="start">Refazer</button>
      </div>
    </template>

    <template v-if="completed && lot">
      <p v-if="view?.analysis?.partial" class="notice warning">Análise parcial: só o edital foi lido</p>

      <label v-if="lots.length > 1" class="field edital-lot-select">
        <span>Lote</span>
        <select v-model.number="lotIndex">
          <option v-for="(item, index) in lots" :key="item.lotId ?? index" :value="index">
            {{ item.lotId ? `Lote ${item.lotId}` : `Lote ${index + 1}` }} · {{ verdictLabel[item.verdict] }}
          </option>
        </select>
      </label>

      <div class="edital-verdict" :class="`verdict-${lot.verdict.toLowerCase()}`">
        <strong>{{ verdictLabel[lot.verdict] }}</strong>
        <span v-if="lot.failCount || lot.checkCount">
          {{ lot.failCount ? `${lot.failCount} não ${lot.failCount === 1 ? 'atende' : 'atendem'}` : '' }}{{ lot.failCount && lot.checkCount ? ' · ' : '' }}{{ lot.checkCount ? `${lot.checkCount} para verificar` : '' }}
        </span>
      </div>

      <ul class="edital-checks">
        <li v-for="check in checks" :key="check.requirementId" class="edital-check" :class="`check-${check.status}`">
          <span class="edital-check-icon" role="img" :aria-label="statusText[check.status]">{{ statusIcon[check.status] }}</span>
          <div class="edital-check-body">
            <strong>{{ check.description }}</strong>
            <dl>
              <div><dt>Exigido</dt><dd>{{ check.required }}</dd></div>
              <div v-if="check.companyValue"><dt>Sua empresa</dt><dd>{{ check.companyValue }}</dd></div>
            </dl>
            <p v-if="check.note" class="edital-muted">{{ check.note }}</p>
            <details v-if="check.excerpt || check.page" class="edital-excerpt">
              <summary>{{ check.page ? `pág. ${check.page}` : 'Trecho do edital' }}</summary>
              <blockquote v-if="check.excerpt">{{ check.excerpt }}</blockquote>
            </details>
            <template v-if="visitDue(check)">
              <span v-if="agendaState[check.requirementId] === 'done'" class="status-pill">Na agenda</span>
              <button
                v-else
                class="btn btn-small btn-ghost"
                type="button"
                :disabled="agendaState[check.requirementId] === 'saving'"
                @click="addVisit(check)"
              >Adicionar à agenda</button>
              <small v-if="agendaState[check.requirementId] === 'error'" class="edital-muted">Não foi possível adicionar à agenda.</small>
            </template>
          </div>
        </li>
      </ul>
    </template>
  </section>
</template>
