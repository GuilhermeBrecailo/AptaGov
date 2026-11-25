<script setup lang="ts">
import type { AuthPayload, CompanyProfile } from '../types';

const { data: auth, error: authError } = await useFetch<AuthPayload>('/api/auth/me');
if (authError.value) await navigateTo('/login');

type Form = {
  registrations: CompanyProfile['registrations'];
  technicians: CompanyProfile['technicians'];
  attestations: CompanyProfile['attestations'];
  // Valores monetários em reais na tela; convertidos para centavos ao salvar.
  netWorth: number | null;
  shareCapital: number | null;
  liquidityGeneral: number | null;
  solvencyGeneral: number | null;
  liquidityCurrent: number | null;
  balanceSheetDate: string | null;
};

const toReais = (cents: number | null) => (cents === null ? null : cents / 100);
const toCents = (reais: number | null) => (reais === null ? null : Math.round(reais * 100));

function toForm(profile: CompanyProfile): Form {
  const { financial } = profile;
  return {
    registrations: profile.registrations.map((item) => ({ ...item })),
    technicians: profile.technicians.map((item) => ({ ...item })),
    attestations: profile.attestations.map((item) => ({ ...item })),
    netWorth: toReais(financial.netWorthCents),
    shareCapital: toReais(financial.shareCapitalCents),
    liquidityGeneral: financial.liquidityGeneral,
    solvencyGeneral: financial.solvencyGeneral,
    liquidityCurrent: financial.liquidityCurrent,
    balanceSheetDate: financial.balanceSheetDate,
  };
}

function toProfile(form: Form): CompanyProfile {
  return {
    registrations: form.registrations.map((item) => ({ ...item, validUntil: item.validUntil || null })),
    technicians: form.technicians.map((item) => ({ ...item })),
    attestations: form.attestations.map((item) => ({
      ...item,
      catNumber: item.catNumber?.trim() || null,
      technicianId: item.technicianId || null,
      issuedAt: item.issuedAt || null,
    })),
    financial: {
      netWorthCents: toCents(form.netWorth),
      shareCapitalCents: toCents(form.shareCapital),
      liquidityGeneral: form.liquidityGeneral,
      solvencyGeneral: form.solvencyGeneral,
      liquidityCurrent: form.liquidityCurrent,
      balanceSheetDate: form.balanceSheetDate || null,
    },
  };
}

const { data: profile } = await useFetch<CompanyProfile>('/api/company-profile');
const form = ref<Form | null>(profile.value ? toForm(profile.value) : null);
const saving = ref(false);
const message = ref('');
const errorMessage = ref('');

function numberFrom(event: Event): number | null {
  const raw = textFrom(event);
  if (raw === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function textFrom(event: Event): string {
  return (event.target as { value: string }).value;
}

function newId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function addRegistration() {
  form.value?.registrations.push({ council: 'CREA', number: '', state: '', validUntil: null });
}

function addTechnician() {
  form.value?.technicians.push({ id: newId(), name: '', title: '', registrationNumber: '' });
}

function removeTechnician(index: number) {
  if (!form.value) return;
  const [removed] = form.value.technicians.splice(index, 1);
  if (!removed) return;
  for (const attestation of form.value.attestations) {
    if (attestation.technicianId === removed.id) attestation.technicianId = null;
  }
}

function addAttestation() {
  form.value?.attestations.push({
    id: newId(), service: '', quantity: 0, unit: '', contractor: '', catNumber: null, technicianId: null, issuedAt: null,
  });
}

function getApiError(error: unknown, fallback: string) {
  if (error && typeof error === 'object' && 'data' in error) {
    const data = error.data;
    if (data && typeof data === 'object' && 'statusMessage' in data && typeof data.statusMessage === 'string') return data.statusMessage;
  }
  return fallback;
}

async function save() {
  if (!form.value) return;
  saving.value = true;
  message.value = '';
  errorMessage.value = '';
  try {
    const saved = await $fetch<CompanyProfile>('/api/company-profile', { method: 'PUT', body: toProfile(form.value) });
    form.value = toForm(saved);
    message.value = 'Perfil técnico salvo.';
  } catch (error) {
    errorMessage.value = getApiError(error, 'Não foi possível salvar o perfil técnico');
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <AppShell :auth="auth" active="profile" content-class="configuration-page">
    <header class="page-header">
      <div class="page-title">
        <h1>Perfil técnico</h1>
      </div>
    </header>
    <p class="configuration-help">Registros, responsáveis, atestados e dados financeiros usados para comparar sua empresa com as exigências do edital.</p>
    <div v-if="message" class="notice" role="status">{{ message }}</div>
    <p v-if="errorMessage" class="form-error" role="alert">{{ errorMessage }}</p>

    <form v-if="form" class="configuration-layout" @submit.prevent="save">
      <section class="content-surface configuration-surface">
        <div class="list-heading"><h2>Registros profissionais da empresa</h2></div>
        <div class="profile-list">
          <div v-for="(item, index) in form.registrations" :key="index" class="profile-row">
            <label class="field"><span>Conselho</span>
              <select v-model="item.council"><option value="CREA">CREA</option><option value="CAU">CAU</option></select>
            </label>
            <label class="field"><span>Número</span><input v-model="item.number" required></label>
            <label class="field"><span>UF</span><input v-model="item.state" required maxlength="2" placeholder="SP"></label>
            <label class="field"><span>Validade</span><input v-model="item.validUntil" type="date"></label>
            <button class="text-action" type="button" @click="form.registrations.splice(index, 1)">Remover</button>
          </div>
        </div>
        <button class="btn btn-ghost btn-small" type="button" @click="addRegistration">Adicionar registro</button>
      </section>

      <section class="content-surface configuration-surface">
        <div class="list-heading"><h2>Responsáveis técnicos</h2></div>
        <div class="profile-list">
          <div v-for="(item, index) in form.technicians" :key="item.id" class="profile-row">
            <label class="field"><span>Nome</span><input v-model="item.name" required></label>
            <label class="field"><span>Título</span><input v-model="item.title" placeholder="Engenheiro civil"></label>
            <label class="field"><span>Registro</span><input v-model="item.registrationNumber"></label>
            <button class="text-action" type="button" @click="removeTechnician(index)">Remover</button>
          </div>
        </div>
        <button class="btn btn-ghost btn-small" type="button" @click="addTechnician">Adicionar responsável</button>
      </section>

      <section class="content-surface configuration-surface">
        <div class="list-heading"><h2>Atestados de capacidade técnica</h2></div>
        <div class="profile-list">
          <div v-for="(item, index) in form.attestations" :key="item.id" class="profile-row">
            <label class="field"><span>Serviço</span><input v-model="item.service" required placeholder="Pavimentação asfáltica"></label>
            <label class="field"><span>Quantidade</span>
              <input :value="item.quantity" type="number" min="0" step="any" required @input="item.quantity = numberFrom($event) ?? 0">
            </label>
            <label class="field"><span>Unidade</span><input v-model="item.unit" required placeholder="m²"></label>
            <label class="field"><span>Contratante</span><input v-model="item.contractor"></label>
            <label class="field"><span>Nº da CAT</span><input :value="item.catNumber ?? ''" @input="item.catNumber = textFrom($event)"></label>
            <label class="field"><span>Responsável</span>
              <select v-model="item.technicianId">
                <option :value="null">Não informado</option>
                <option v-for="tech in form.technicians" :key="tech.id" :value="tech.id">{{ tech.name || 'Sem nome' }}</option>
              </select>
            </label>
            <label class="field"><span>Emissão</span><input v-model="item.issuedAt" type="date"></label>
            <button class="text-action" type="button" @click="form.attestations.splice(index, 1)">Remover</button>
          </div>
        </div>
        <button class="btn btn-ghost btn-small" type="button" @click="addAttestation">Adicionar atestado</button>
      </section>

      <section class="content-surface configuration-surface">
        <div class="list-heading"><h2>Dados financeiros</h2></div>
        <div class="configuration-grid">
          <label class="field"><span>Patrimônio líquido (R$)</span>
            <input :value="form.netWorth ?? ''" type="number" step="0.01" @input="form.netWorth = numberFrom($event)">
          </label>
          <label class="field"><span>Capital social (R$)</span>
            <input :value="form.shareCapital ?? ''" type="number" min="0" step="0.01" @input="form.shareCapital = numberFrom($event)">
          </label>
          <label class="field"><span>Liquidez geral</span>
            <input :value="form.liquidityGeneral ?? ''" type="number" min="0" step="0.01" @input="form.liquidityGeneral = numberFrom($event)">
          </label>
          <label class="field"><span>Solvência geral</span>
            <input :value="form.solvencyGeneral ?? ''" type="number" min="0" step="0.01" @input="form.solvencyGeneral = numberFrom($event)">
          </label>
          <label class="field"><span>Liquidez corrente</span>
            <input :value="form.liquidityCurrent ?? ''" type="number" min="0" step="0.01" @input="form.liquidityCurrent = numberFrom($event)">
          </label>
          <label class="field"><span>Data do balanço</span><input v-model="form.balanceSheetDate" type="date"></label>
        </div>
      </section>

      <div><button class="btn btn-primary" type="submit" :disabled="saving">{{ saving ? 'Salvando…' : 'Salvar perfil técnico' }}</button></div>
    </form>
    <p v-else class="form-error" role="alert">Não foi possível carregar o perfil técnico.</p>
  </AppShell>
</template>
