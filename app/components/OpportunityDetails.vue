<script setup lang="ts">
import type { CatalogOpportunity } from '../types';

defineProps<{ item: CatalogOpportunity | null }>();
const emit = defineEmits<{ close: []; feedback: [status: 'FAVORITED' | 'NOT_RELEVANT' | null] }>();

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
      <span class="details-source">Fonte: {{ item.source === 'OPEN_DATA' ? 'Dados Abertos' : 'PNCP' }}</span>
      <h2>{{ item.title }}</h2>
      <p class="details-organization">{{ item.organization }}{{ item.city ? ` · ${item.city}` : '' }}</p>
      <div class="details-grid"><div><small>Publicação</small><strong>{{ date(item.publicationDate) }}</strong></div><div><small>Prazo</small><strong>{{ date(item.biddingDeadline) }}</strong></div><div><small>Valor estimado</small><strong>{{ item.estimatedValueCents ? money(item.estimatedValueCents) : 'Não informado' }}</strong></div></div>
      <div class="details-section"><span class="details-eyebrow">Sobre a contratação</span><p>{{ item.description || 'O edital não trouxe uma descrição complementar.' }}</p></div>
      <div class="details-section score-explanation"><span class="details-eyebrow">Por que apareceu</span><p class="score-explanation-copy">Score calculado por regras configuráveis da sua empresa.</p><div v-for="(value, key) in item.scoreBreakdown" :key="key" class="score-breakdown-row"><span>{{ scoreLabel(String(key)) }}</span><strong>{{ value }} pts</strong></div></div>
      <div class="details-actions"><button class="btn btn-outline" type="button" @click="emit('feedback', item.favorite ? null : 'FAVORITED')">{{ item.favorite ? 'Remover favorita' : 'Favoritar oportunidade' }}</button><button class="btn btn-ghost" type="button" @click="emit('feedback', item.notRelevant ? null : 'NOT_RELEVANT')">{{ item.notRelevant ? 'Mostrar novamente' : 'Não é relevante' }}</button></div>
      <a class="btn btn-primary full-button" :href="item.sourceUrl" target="_blank" rel="noreferrer">Abrir no PNCP ↗</a>
    </aside>
  </div>
</template>
