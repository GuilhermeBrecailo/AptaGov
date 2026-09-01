<script setup lang="ts">
import type { BillingPlanView } from '../types';

defineProps<{
  plans: BillingPlanView[];
  selectedCode: BillingPlanView['code'];
  currentCode?: BillingPlanView['code'];
  busy: boolean;
}>();

const emit = defineEmits<{ select: [code: BillingPlanView['code']] }>();

function price(cents: number): string {
  return (cents / 100).toFixed(2).replace('.', ',');
}

function userLimit(value: number | null): string {
  return value === null ? 'Equipe sem limite' : `${value} ${value === 1 ? 'usuário' : 'usuários'}`;
}

function alertLimit(value: number | null): string {
  return value === null ? 'Alertas sem limite' : `${value.toLocaleString('pt-BR')} alertas/mês`;
}

function radarLimit(value: number | null): string {
  return value === null ? 'Radares sem limite' : `${value} ${value === 1 ? 'radar' : 'radares'}`;
}
</script>

<template>
  <section class="pricing-section">
    <div class="pricing-heading">
      <div>
        <span class="section-kicker">Escolha o ritmo da sua operação</span>
        <h2>Um plano para cada fase</h2>
      </div>
      <span class="pricing-note">Cancele quando quiser</span>
    </div>
    <div class="billing-plans">
      <article v-for="plan in plans" :key="plan.code" class="plan-card" :class="{ featured: plan.code === 'PRO', selected: selectedCode === plan.code }">
        <span v-if="plan.code === 'PRO'" class="plan-tag">Mais escolhido</span>
        <span class="plan-kicker">{{ plan.name }}</span>
        <h3>R$ {{ price(plan.priceCents) }}<small>/mês</small></h3>
        <p>{{ plan.description }}</p>
        <ul>
          <li>Catálogo, score e Kanban completos</li>
          <li>{{ userLimit(plan.maxUsers) }}</li>
          <li>{{ alertLimit(plan.monthlyAlerts) }}</li>
          <li>{{ radarLimit(plan.maxRadars) }}</li>
        </ul>
        <button class="btn" :class="plan.code === 'PRO' ? 'btn-primary' : 'btn-ghost'" :disabled="busy || currentCode === plan.code" @click="emit('select', plan.code)">
          {{ currentCode === plan.code ? 'Plano atual' : busy && selectedCode === plan.code ? 'Abrindo checkout…' : `Escolher ${plan.name}` }}
        </button>
      </article>
    </div>
  </section>
</template>
