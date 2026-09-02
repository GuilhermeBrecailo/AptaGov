<script setup lang="ts">
import type { MarketDataState, MarketSummary as MarketSummaryData } from '../types';

withDefaults(defineProps<{
  summary: MarketSummaryData | null;
  state?: MarketDataState;
  message?: string | null;
  loading?: boolean;
  compact?: boolean;
}>(), {
  state: undefined,
  message: null,
  loading: false,
  compact: false,
});

function money(cents: number | null): string {
  if (cents === null) return '—';
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2 }).format(cents / 100);
}

function date(value: string | null): string {
  return value ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium' }).format(new Date(value)) : 'Sem atualização';
}

function month(value: string): string {
  return new Intl.DateTimeFormat('pt-BR', { month: 'short' }).format(new Date(`${value}-01T00:00:00.000Z`)).replace('.', '');
}

function maxMonthlyCount(summary: MarketSummaryData): number {
  return Math.max(1, ...summary.monthlySeries.map((entry) => entry.count));
}

function width(count: number, summary: MarketSummaryData): string {
  return `${Math.max(4, Math.round((count / maxMonthlyCount(summary)) * 100))}%`;
}
</script>

<template>
  <section class="market-summary" :class="{ compact, 'is-insufficient': state === 'INSUFFICIENT_DATA' || summary?.state === 'INSUFFICIENT_DATA' }" aria-labelledby="market-summary-title">
    <header class="market-summary-header">
      <div>
        <span class="section-kicker">Histórico oficial</span>
        <h2 id="market-summary-title">Referência de mercado</h2>
        <p v-if="compact">Preços praticados em registros compatíveis com esta oportunidade.</p>
        <p v-else>Uma leitura auditável de compras e resultados oficiais para este recorte.</p>
      </div>
      <span v-if="summary?.state === 'READY'" class="market-status ready">Amostra suficiente</span>
      <span v-else-if="!loading" class="market-status insufficient">Dados insuficientes</span>
    </header>

    <div v-if="loading" class="market-empty" role="status">Carregando referência oficial…</div>
    <div v-else-if="!summary" class="market-empty">
      <strong>Dados insuficientes para comparação</strong>
      <span>{{ message || 'É necessário ter código, descrição e unidade compatíveis.' }}</span>
    </div>
    <template v-else>
      <div v-if="summary.state === 'INSUFFICIENT_DATA'" class="market-quality-note" role="status">
        <strong>Dados insuficientes para uma referência segura.</strong>
        <span>{{ summary.observationCount }} de {{ summary.minimumObservations }} observações com preço unitário necessário.</span>
      </div>

      <div class="market-price-strip">
        <div><small>Mínimo unitário</small><strong>{{ money(summary.minPriceCents) }}</strong><span>Preço em centavos</span></div>
        <div class="market-price-focus"><small>Mediana unitária</small><strong>{{ money(summary.medianPriceCents) }}</strong><span>{{ summary.observationCount }} observações compatíveis</span></div>
        <div><small>Máximo unitário</small><strong>{{ money(summary.maxPriceCents) }}</strong><span>Preço em centavos</span></div>
        <div><small>Compras</small><strong>{{ summary.purchaseCount }}</strong><span>No período consultado</span></div>
      </div>

      <div class="market-summary-grid">
        <section class="market-panel market-trend">
          <div class="market-panel-heading"><div><span class="section-kicker">Ritmo das compras</span><h3>Evolução mensal</h3></div><span>{{ summary.observationCount }} preços</span></div>
          <div class="market-months">
            <div v-for="entry in summary.monthlySeries" :key="entry.month" class="market-month">
              <div class="market-month-bar"><i :style="{ height: width(entry.count, summary) }" /><span>{{ entry.count }}</span></div>
              <strong>{{ month(entry.month) }}</strong>
              <small>{{ money(entry.medianPriceCents) }}</small>
            </div>
          </div>
        </section>

        <section class="market-panel">
          <div class="market-panel-heading"><div><span class="section-kicker">Onde compraram</span><h3>Órgãos e regiões</h3></div></div>
          <div class="market-rankings">
            <div><strong>Órgãos</strong><p v-for="entry in summary.topOrganizations.slice(0, 4)" :key="entry.label"><span>{{ entry.label }}</span><b>{{ entry.count }}</b></p></div>
            <div><strong>Estados</strong><p v-for="entry in summary.topRegions.slice(0, 4)" :key="entry.label"><span>{{ entry.label }}</span><b>{{ entry.count }}</b></p></div>
          </div>
        </section>
      </div>

      <div class="market-summary-columns">
        <section class="market-panel"><div class="market-panel-heading"><div><span class="section-kicker">Contexto</span><h3>Modalidade</h3></div></div><p v-for="entry in summary.modalityBreakdown" :key="entry.label" class="market-breakdown-row"><span>{{ entry.label }}</span><b>{{ entry.count }}</b></p></section>
        <section class="market-panel"><div class="market-panel-heading"><div><span class="section-kicker">Resultado</span><h3>Situação</h3></div></div><p v-for="entry in summary.statusBreakdown" :key="entry.label" class="market-breakdown-row"><span>{{ entry.label }}</span><b>{{ entry.count }}</b></p></section>
      </div>

      <footer class="market-summary-footer">
        <span>Última atualização: {{ date(summary.lastUpdatedAt) }}</span>
        <div class="market-links"><a v-for="link in summary.sourceLinks.slice(0, 6)" :key="`${link.sourceCode}-${link.externalId}-${link.url}`" :href="link.url" target="_blank" rel="noreferrer">{{ link.sourceLabel }} · abrir fonte oficial ↗</a></div>
      </footer>
    </template>
  </section>
</template>
