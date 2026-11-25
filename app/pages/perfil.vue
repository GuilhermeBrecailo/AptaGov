<script setup lang="ts">
import type { AuthPayload, CompanyProfile } from '../types';
import { formToProfile, profileToForm, type ProfileForm } from '../viewModels/profileFormViewModel';

const { data: auth, error: authError } = await useFetch<AuthPayload>('/api/auth/me');
if (authError.value) await navigateTo('/login');

const { data: profile } = await useFetch<CompanyProfile>('/api/company-profile');
// Campos numéricos ficam como texto até salvar, para não apagar o que está sendo digitado ("-", "1e").
const form = ref<ProfileForm | null>(profile.value ? profileToForm(profile.value) : null);
const saving = ref(false);
const message = ref('');
const errorMessage = ref('');

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
    id: newId(), service: '', quantity: '', unit: '', contractor: '', catNumber: null, technicianId: null, issuedAt: null,
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
  message.value = '';
  errorMessage.value = '';
  const converted = formToProfile(form.value);
  if (!converted.ok) {
    errorMessage.value = converted.error;
    return;
  }
  saving.value = true;
  try {
    const saved = await $fetch<CompanyProfile>('/api/company-profile', { method: 'PUT', body: converted.profile });
    form.value = profileToForm(saved);
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
              <input v-model="item.quantity" type="text" inputmode="decimal" required>
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
            <input v-model="form.netWorth" type="text" inputmode="decimal">
          </label>
          <label class="field"><span>Capital social (R$)</span>
            <input v-model="form.shareCapital" type="text" inputmode="decimal">
          </label>
          <label class="field"><span>Liquidez geral</span>
            <input v-model="form.liquidityGeneral" type="text" inputmode="decimal">
          </label>
          <label class="field"><span>Solvência geral</span>
            <input v-model="form.solvencyGeneral" type="text" inputmode="decimal">
          </label>
          <label class="field"><span>Liquidez corrente</span>
            <input v-model="form.liquidityCurrent" type="text" inputmode="decimal">
          </label>
          <label class="field"><span>Data do balanço</span><input v-model="form.balanceSheetDate" type="date"></label>
        </div>
      </section>

      <div><button class="btn btn-primary" type="submit" :disabled="saving">{{ saving ? 'Salvando…' : 'Salvar perfil técnico' }}</button></div>
    </form>
    <p v-else class="form-error" role="alert">Não foi possível carregar o perfil técnico.</p>
  </AppShell>
</template>
