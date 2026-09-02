<script setup lang="ts">
import { watch } from 'vue';
import OpportunityChecklist from './OpportunityChecklist.vue';
import MarketSummary from './MarketSummary.vue';
import type { CatalogOpportunity, ChecklistPatchInput, ChecklistItem, OpportunityMarketPayload } from '../types';

const props = defineProps<{
  item: CatalogOpportunity | null;
  checklistItems?: ChecklistItem[];
  checklistLoading?: boolean;
  checklistSaving?: boolean;
  currentUser?: { id: number; name: string } | null;
}>();

const market = ref<OpportunityMarketPayload | null>(null);
const marketLoading = ref(false);
const marketError = ref<string | null>(null);
let marketRequest = 0;

watch(() => props.item?.id, async (opportunityId) => {
  const request = ++marketRequest;
  market.value = null;
  marketError.value = null;
  if (!opportunityId) return;
  marketLoading.value = true;
  try {
    const response = await $fetch<OpportunityMarketPayload>(`/api/opportunities/${opportunityId}/market`);
    if (request === marketRequest) market.value = response;
  } catch {
    if (request === marketRequest) marketError.value = 'Dados insuficientes para comparação';
  } finally {
    if (request === marketRequest) marketLoading.value = false;
  }
}, { immediate: true });
const emit = defineEmits<{
  close: [];
  feedback: [status: 'FAVORITED' | 'NOT_RELEVANT' | null];
  checklistComplete: [itemId: number];
  checklistSave: [itemId: number, patch: ChecklistPatchInput];
}>();

function money(cents: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(cents / 100);
}

function date(value: string | null) {
  return value ? new Intl.DateTimeFormat('pt-BR').format(new Date(value)) : 'Sem prazo informado';
}

function scoreLabel(value: string): string {
  return ({ keyword: 'Palavras-chave', region: 'Região', value: 'Valor', deadline: 'Prazo' } as Record<string, string>)[value] ?? value;
}
</script>

<template>
  <div v-if="item" class="details-backdrop" @click.self="emit('close')">
    <aside class="details-panel">
      <button class="close-button" aria-label="Fechar detalhes" @click="emit('close')">×</button>
      <span class="score-badge large">{{ item.score }}/100 · regras</span>
      <span class="details-eyebrow">{{ item.state }} · {{ item.modality || 'Modalidade não informada' }}</span>
      <span class="details-source">Fonte: {{ item.sourceLabel }}</span>
      <h2>{{ item.title }}</h2>
      <p class="details-organization">{{ item.organization }}{{ item.city ? ` · ${item.city}` : '' }}</p>
      <div class="details-grid"><div><small>Publicação</small><strong>{{ date(item.publicationDate) }}</strong></div><div><small>Prazo</small><strong>{{ date(item.biddingDeadline) }}</strong></div><div><small>Valor estimado</small><strong>{{ item.estimatedValueCents ? money(item.estimatedValueCents) : 'Não informado' }}</strong></div></div>
      <MarketSummary
        :summary="market?.comparison ?? null"
        :state="market?.state"
        :message="market?.message ?? marketError"
        :loading="marketLoading"
        compact
      />
      <OpportunityChecklist
        v-if="item.inKanban"
        :items="checklistItems ?? []"
        :loading="checklistLoading"
        :saving="checklistSaving"
        :current-user="currentUser"
        @quick-complete="emit('checklistComplete', $event)"
        @save-item="emit('checklistSave', $event.id, $event.patch)"
      />
      <div class="details-section"><span class="details-eyebrow">Sobre a contratação</span><p>{{ item.description || 'O edital não trouxe uma descrição complementar.' }}</p></div>
      <div class="details-section score-explanation"><span class="details-eyebrow">Por que apareceu</span><p class="score-explanation-copy">Score calculado por regras configuráveis da sua empresa.</p><div v-for="(value, key) in item.scoreBreakdown" :key="key" class="score-breakdown-row"><span>{{ scoreLabel(String(key)) }}</span><strong>{{ value }} pts</strong></div></div>
      <div class="details-actions"><button class="btn btn-outline" type="button" @click="emit('feedback', item.favorite ? null : 'FAVORITED')">{{ item.favorite ? 'Remover favorita' : 'Favoritar oportunidade' }}</button><button class="btn btn-ghost" type="button" @click="emit('feedback', item.notRelevant ? null : 'NOT_RELEVANT')">{{ item.notRelevant ? 'Mostrar novamente' : 'Não é relevante' }}</button></div>
      <a class="btn btn-primary full-button" :href="item.sourceUrl" target="_blank" rel="noreferrer">Abrir na fonte oficial ↗</a>
    </aside>
  </div>
</template>
