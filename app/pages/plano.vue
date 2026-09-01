<script setup lang="ts">
import { watch } from 'vue';
import BillingPlans from '../components/BillingPlans.vue';
import type { AuthPayload, BillingPayload, BillingPlanView } from '../types';

const { data: auth, error: authError } = await useFetch<AuthPayload>('/api/auth/me');
if (authError.value) await navigateTo('/login');

const { data: billing, refresh: refreshBilling } = await useFetch<BillingPayload>('/api/billing');
const selectedPlanCode = ref<BillingPlanView['code']>('STARTER');
const billingBusy = ref(false);
const message = ref('');

watch(() => billing.value?.planCode, (code) => {
  if (code) selectedPlanCode.value = code;
}, { immediate: true });

function formatPrice(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatDate(value: string | null): string {
  if (!value) return 'sem data definida';
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium' }).format(new Date(value));
}

function statusLabel(status: BillingPayload['status']): string {
  return {
    ACTIVE: 'Ativo',
    TRIALING: 'Período de teste',
    PAST_DUE: 'Pagamento pendente',
    CANCELED: 'Cancelado',
    INACTIVE: 'Inativo',
  }[status];
}

async function activatePlan(planCode: BillingPlanView['code']) {
  billingBusy.value = true;
  selectedPlanCode.value = planCode;
  message.value = '';
  try {
    const checkout = await $fetch<{ checkoutUrl: string }>('/api/billing/checkout', { method: 'POST', body: { plan: planCode } });
    globalThis.location.assign(checkout.checkoutUrl);
  } catch (error) {
    message.value = error instanceof Error ? error.message : 'Não foi possível abrir o checkout.';
  } finally {
    billingBusy.value = false;
    await refreshBilling();
  }
}

async function logout() {
  await $fetch('/api/auth/logout', { method: 'POST' });
  await navigateTo('/login');
}
</script>

<template>
  <div class="product-shell">
    <header class="app-topbar">
      <div class="topbar-brand-area">
        <AppNavDrawer :auth="auth" active="plan" @logout="logout" />
        <div class="brand-lockup"><div class="brand-mark">A</div><div><span class="brand-name">AptaGov</span><span class="brand-caption">Inteligência para vender ao governo</span></div></div>
      </div>
      <div class="account-area"><span class="user-name">{{ auth?.user.name }}</span><button class="topbar-action" type="button" @click="logout">Sair</button></div>
    </header>

    <main class="app-content plan-page">
      <div class="app-heading">
        <div><span class="section-kicker">Cresça no seu ritmo</span><h1>Plano</h1><p>Veja o que está incluído e escolha o espaço que sua operação precisa.</p></div>
        <NuxtLink class="btn btn-ghost" to="/">Voltar ao painel</NuxtLink>
      </div>
      <div v-if="message" class="notice warning">{{ message }}</div>

      <template v-if="billing">
        <section class="plan-current-card">
          <div><span class="section-kicker">Plano atual</span><h2>{{ billing.plans.find((plan) => plan.code === billing.planCode)?.name ?? 'Inicial' }}</h2><p>Status: <strong>{{ statusLabel(billing.status) }}</strong>. {{ billing.status === 'TRIALING' ? `Seu teste termina em ${formatDate(billing.trialEndsAt)}.` : 'Os limites abaixo são aplicados à sua organização.' }}</p></div>
          <div class="plan-current-price"><strong>{{ formatPrice(billing.monthlyPriceCents) }}</strong><span>por mês</span><small v-if="billing.currentPeriodEndsAt">Renova até {{ formatDate(billing.currentPeriodEndsAt) }}</small></div>
        </section>

        <BillingPlans :plans="billing.plans" :selected-code="selectedPlanCode" :current-code="billing.planCode" :busy="billingBusy || auth?.role !== 'OWNER'" @select="activatePlan" />
        <p v-if="auth?.role !== 'OWNER'" class="plan-owner-note">Somente o proprietário da organização pode alterar o plano.</p>
      </template>
    </main>
  </div>
</template>
