<script setup lang="ts">
import type { AuthPayload, FilterConfig, OnboardingPayload } from '../types';

const { data: auth, error: authError } = await useFetch<AuthPayload>('/api/auth/me');
if (authError.value) await navigateTo('/login');

const { data: onboarding } = await useFetch<OnboardingPayload>('/api/onboarding');
const step = ref(1);
const pending = ref(false);
const message = ref('');
const radarName = ref('Radar principal');
const automaticSyncEnabled = ref(true);
const notificationsEnabled = ref(true);
const notificationEmail = ref(auth.value?.user.email ?? '');
const filters = ref<FilterConfig>(cloneFilters(onboarding.value?.filters ?? defaultFilters()));

type ListFilterKey = 'keywords' | 'excludedKeywords' | 'states' | 'citiesIbge' | 'modalities';

function updateList(key: ListFilterKey, event: Event) {
  filters.value[key] = String((event.target as HTMLTextAreaElement).value)
    .split(/[,.\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function listValue(key: ListFilterKey): string {
  return filters.value[key].join(', ');
}

function nextStep() {
  if (step.value < 3) step.value += 1;
}

function previousStep() {
  if (step.value > 1) step.value -= 1;
}

async function finish() {
  pending.value = true;
  message.value = '';
  try {
    await $fetch('/api/onboarding', {
      method: 'PUT',
      body: {
        radarName: radarName.value,
        filters: filters.value,
        automaticSyncEnabled: automaticSyncEnabled.value,
        notificationsEnabled: notificationsEnabled.value,
        notificationEmail: notificationEmail.value,
      },
    });
    await navigateTo('/');
  } catch (error) {
    message.value = getApiError(error, 'Não foi possível salvar seu primeiro radar.');
  } finally {
    pending.value = false;
  }
}

async function skip() {
  await navigateTo('/');
}

function defaultFilters(): FilterConfig {
  return {
    lookbackDays: 3,
    states: [],
    citiesIbge: [],
    modalities: ['6'],
    keywords: [],
    excludedKeywords: [],
    minimumScore: 45,
    estimatedValueMinCents: 0,
    scoreWeights: { keyword: 50, region: 20, value: 10, deadline: 20 },
  };
}

function cloneFilters(value: FilterConfig): FilterConfig {
  return JSON.parse(JSON.stringify(value)) as FilterConfig;
}

function getApiError(error: unknown, fallback: string): string {
  if (error && typeof error === 'object' && 'data' in error) {
    const data = error.data;
    if (data && typeof data === 'object' && 'statusMessage' in data && typeof data.statusMessage === 'string') return data.statusMessage;
  }
  return fallback;
}
</script>

<template>
  <main class="onboarding-shell">
    <section class="onboarding-intro">
      <div class="onboarding-brand"><span class="brand-mark">A</span><div><strong>AptaGov</strong><small>Seu radar de oportunidades públicas</small></div></div>
      <div class="onboarding-intro-copy">
        <span class="auth-kicker">Primeiros passos</span>
        <h1>Vamos encontrar as licitações certas para {{ auth?.organization.name }}.</h1>
        <p>Em menos de dois minutos, você cria um radar sob medida. Depois pode editar tudo na configuração.</p>
      </div>
      <div class="onboarding-intro-note"><span>✓</span><p>Sem IA e sem complicação: seu score começa com regras transparentes que você controla.</p></div>
    </section>

    <section class="onboarding-panel">
      <div class="onboarding-card">
        <div class="onboarding-progress"><span v-for="item in 3" :key="item" :class="{ active: item <= step }" /></div>
        <div class="onboarding-step-label">Passo {{ step }} de 3</div>

        <div v-if="step === 1" class="onboarding-step">
          <span class="section-kicker">Seu mercado</span>
          <h2>O que sua empresa fornece?</h2>
          <p class="auth-muted">Use termos que aparecem nos editais. Separe por vírgulas.</p>
          <label class="field"><span>Palavras-chave</span><textarea :value="listValue('keywords')" placeholder="software, suporte, manutenção" @change="updateList('keywords', $event)" /></label>
          <label class="field"><span>O que não interessa</span><textarea :value="listValue('excludedKeywords')" placeholder="obra, combustível, alimentação" @change="updateList('excludedKeywords', $event)" /></label>
        </div>

        <div v-else-if="step === 2" class="onboarding-step">
          <span class="section-kicker">Onde disputar</span>
          <h2>Escolha o território e o tipo.</h2>
          <p class="auth-muted">Você poderá criar outros radares depois para separar estratégias.</p>
          <div class="onboarding-grid">
            <label class="field"><span>Estados</span><input :value="listValue('states')" placeholder="SP, PR, SC" @change="updateList('states', $event)"></label>
            <label class="field"><span>Cidades (IBGE)</span><input :value="listValue('citiesIbge')" placeholder="3550308" @change="updateList('citiesIbge', $event)"></label>
            <label class="field"><span>Modalidades</span><input :value="listValue('modalities')" placeholder="6, 8" @change="updateList('modalities', $event)"></label>
            <label class="field"><span>Nome do radar</span><input v-model="radarName" required placeholder="Software em SP"></label>
            <label class="field"><span>Score mínimo</span><input v-model.number="filters.minimumScore" type="number" min="0" max="100"></label>
            <label class="field"><span>Buscar nos últimos dias</span><input v-model.number="filters.lookbackDays" type="number" min="1" max="365"></label>
          </div>
        </div>

        <div v-else class="onboarding-step">
          <span class="section-kicker">Como acompanhar</span>
          <h2>Deixe o radar trabalhar por você.</h2>
          <p class="auth-muted">Você poderá mudar estas opções em Configuração.</p>
          <div class="onboarding-choice"><div><strong>Busca automática</strong><span>Consultar novas licitações a cada 10 minutos.</span></div><input v-model="automaticSyncEnabled" type="checkbox" aria-label="Ativar busca automática"></div>
          <div class="onboarding-choice"><div><strong>Alertas por e-mail</strong><span>Receber um aviso quando aparecer uma oportunidade aderente.</span></div><input v-model="notificationsEnabled" type="checkbox" aria-label="Ativar alertas por e-mail"></div>
          <label v-if="notificationsEnabled" class="field"><span>E-mail para os alertas</span><input v-model="notificationEmail" type="email" required placeholder="voce@empresa.com"></label>
          <p v-if="message" class="form-error" role="alert">{{ message }}</p>
        </div>

        <div class="onboarding-actions"><button class="btn btn-ghost" type="button" @click="step === 1 ? skip() : previousStep()">{{ step === 1 ? 'Fazer depois' : 'Voltar' }}</button><button v-if="step < 3" class="btn btn-primary" type="button" @click="nextStep">Continuar <span>→</span></button><button v-else class="btn btn-primary" type="button" :disabled="pending" @click="finish">{{ pending ? 'Salvando…' : 'Criar meu radar' }} <span>→</span></button></div>
      </div>
      <p class="onboarding-foot">Você poderá ajustar palavras-chave, score, notificações e busca automática quando quiser.</p>
    </section>
  </main>
</template>
