<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import EditalAnalysisPanel from '../../components/EditalAnalysisPanel.vue';
import OpportunityChecklist from '../../components/OpportunityChecklist.vue';
import { deadlineInfo, formatDate, formatMoney, scoreTone } from '../../utils/format';
import { platformFor } from '../../utils/platform';
import { fileRows, formatDateTime, itemRows, itemsTotalLabel, pageOf, staleLabel } from '../../viewModels/opportunityDetailViewModel';
import type { AuthPayload, ChecklistItem, ChecklistPatchInput, OpportunityDetailResponse } from '../../types';

const route = useRoute();
const router = useRouter();

const { data: auth, error: authError } = await useFetch<AuthPayload>('/api/auth/me');
if (authError.value) await navigateTo('/login');

const opportunityId = computed(() => {
  const parsed = Number(route.params.id);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
});

const { data: detail, pending, error } = await useFetch<OpportunityDetailResponse>(
  () => `/api/opportunities/${opportunityId.value ?? 0}/detail`,
  { immediate: opportunityId.value !== null },
);

const notFound = computed(() => opportunityId.value === null || (error.value as { statusCode?: number } | null)?.statusCode === 404);
const failed = computed(() => Boolean(error.value) && !notFound.value);

const opportunity = computed(() => detail.value?.opportunity ?? null);
const pncp = computed(() => detail.value?.pncp ?? null);
// A abertura da sessão só aparece quando a fonte a publica; no PNCP ela coincide com o fim das propostas.
const deadlines = computed(() => (detail.value?.deadlines ?? []).filter((d) => d.key !== 'opening' || d.at));
const rows = computed(() => itemRows(pncp.value?.items ?? []));
const total = computed(() => itemsTotalLabel(pncp.value?.items ?? []));
const files = computed(() => fileRows(pncp.value?.files ?? []));
const itemPage = ref(1);
const pagination = computed(() => pageOf(rows.value, itemPage.value));
const platform = computed(() => platformFor(opportunity.value?.sourceUrl));
const hasItems = computed(() => rows.value.length > 0);


function goBack() {
  // O painel guarda a busca na URL: voltar no histórico a preserva; sem histórico, vai para a raiz.
  if (import.meta.client && typeof globalThis.history.state?.back === 'string') router.back();
  else void navigateTo('/');
}

const checklist = ref<ChecklistItem[]>([]);
const checklistLoading = ref(false);
const checklistSaving = ref(false);
const checklistMessage = ref('');

watch(() => (opportunity.value?.inKanban ? opportunity.value.id : null), async (id) => {
  if (!id) return;
  checklistLoading.value = true;
  try {
    checklist.value = await $fetch<ChecklistItem[]>(`/api/opportunities/${id}/checklist`);
  } catch (caught) {
    checklistMessage.value = caught instanceof Error ? caught.message : 'Não foi possível carregar a preparação.';
  } finally {
    checklistLoading.value = false;
  }
}, { immediate: true });

async function saveChecklistItem(itemId: number, patch: ChecklistPatchInput) {
  if (!opportunity.value || checklistSaving.value) return;
  checklistSaving.value = true;
  try {
    const updated = await $fetch<ChecklistItem>(`/api/opportunities/${opportunity.value.id}/checklist/${itemId}`, { method: 'PATCH', body: patch });
    checklist.value = checklist.value.map((item) => item.id === itemId ? updated : item);
  } catch (caught) {
    checklistMessage.value = caught instanceof Error ? caught.message : 'Não foi possível salvar o item.';
  } finally {
    checklistSaving.value = false;
  }
}
</script>

<template>
  <AppShell :auth="auth" active="panel" content-class="detail-page">
    <button type="button" class="btn btn-ghost btn-small detail-back" @click="goBack">← Voltar para as licitações</button>

    <p v-if="pending" class="detail-state" role="status">Carregando licitação…</p>

    <section v-else-if="notFound" class="detail-state" role="alert">
      <h1>Licitação não encontrada</h1>
      <p>Ela pode ter sido removida ou o link está incorreto.</p>
      <NuxtLink class="btn btn-primary" to="/">Voltar para as licitações</NuxtLink>
    </section>

    <section v-else-if="failed || !opportunity || !pncp" class="detail-state" role="alert">
      <h1>Não foi possível carregar a licitação</h1>
      <p>Tente novamente em instantes.</p>
      <NuxtLink class="btn btn-primary" to="/">Voltar para as licitações</NuxtLink>
    </section>

    <article v-else class="detail-content">
      <header class="detail-header">
        <div class="details-badges">
          <span class="score-badge large" :class="`tone-${scoreTone(opportunity.score)}`">{{ opportunity.score }}/100 · aderência</span>
          <span v-if="deadlineInfo(opportunity.biddingDeadline)" class="deadline-chip" :class="`tone-${deadlineInfo(opportunity.biddingDeadline)?.tone}`">{{ deadlineInfo(opportunity.biddingDeadline)?.label }}</span>
        </div>
        <span class="details-eyebrow">{{ opportunity.state }} · {{ opportunity.modality || 'Modalidade não informada' }}</span>
        <h1>{{ opportunity.title }}</h1>
        <p class="details-organization">{{ opportunity.organization }}{{ opportunity.city ? ` · ${opportunity.city}` : '' }}</p>
        <span class="details-source">Fonte: {{ opportunity.sourceLabel }}</span>
        <div class="details-grid">
          <div><small>Publicação</small><strong>{{ formatDate(opportunity.publicationDate) }}</strong></div>
          <div><small>Prazo</small><strong>{{ formatDate(opportunity.biddingDeadline) }}</strong></div>
          <div><small>Valor estimado</small><strong>{{ opportunity.estimatedValueCents ? formatMoney(opportunity.estimatedValueCents) : 'Não informado' }}</strong></div>
        </div>
        <a v-if="platform.href" class="btn btn-primary" :href="platform.href" target="_blank" rel="noreferrer">{{ platform.label }}</a>
        <span v-else class="details-eyebrow">{{ platform.label }}</span>
      </header>

      <section class="detail-section" aria-labelledby="detail-deadlines">
        <h2 id="detail-deadlines">Prazos</h2>
        <ul class="detail-deadlines">
          <li v-for="deadline in deadlines" :key="deadline.key">
            <span>{{ deadline.label }}</span>
            <strong>{{ formatDateTime(deadline.at) }}</strong>
            <small v-if="deadline.note">{{ deadline.note }}</small>
          </li>
        </ul>
      </section>

      <OpportunityChecklist
        v-if="opportunity.inKanban"
        :items="checklist"
        :loading="checklistLoading"
        :saving="checklistSaving"
        :current-user="auth?.user ?? null"
        @quick-complete="saveChecklistItem($event, { status: 'COMPLETED' })"
        @save-item="saveChecklistItem($event.id, $event.patch)"
      />
      <p v-if="checklistMessage" class="detail-note" role="status">{{ checklistMessage }}</p>

      <section class="detail-section" aria-labelledby="detail-items">
        <h2 id="detail-items">Itens</h2>
        <p v-if="pncp.source === 'platform-only'" class="detail-note" role="status">Itens e arquivos disponíveis na plataforma de origem. Use o botão acima para abrir.</p>
        <p v-else-if="pncp.unavailable && !hasItems" class="detail-note" role="status">PNCP indisponível agora. Tente novamente mais tarde.</p>
        <template v-else>
          <p v-if="pncp.unavailable" class="detail-note" role="status">PNCP indisponível agora.</p>
          <p v-if="pncp.stale" class="detail-note" role="status">{{ staleLabel(pncp.fetchedAt) }}</p>
          <p v-if="pncp.truncated" class="detail-note" role="status">Mostrando os primeiros 1.000 itens</p>
          <template v-if="hasItems">
            <p class="detail-total"><span>Total estimado</span> <strong>{{ total }}</strong></p>
            <div class="detail-table-scroll" tabindex="0" role="region" aria-labelledby="detail-items-caption">
              <table class="detail-table">
                <caption id="detail-items-caption">Itens da contratação ({{ pncp.itemsTotal.toLocaleString('pt-BR') }})</caption>
                <thead>
                  <tr>
                    <th scope="col">Nº</th><th scope="col">Descrição</th><th scope="col">Quantidade</th><th scope="col">Valor unitário</th>
                    <th scope="col">Valor total</th><th scope="col">Critério</th><th scope="col">Benefício</th><th scope="col">Situação</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="row in pagination.rows" :key="row.number">
                    <th scope="row">{{ row.number }}</th>
                    <td class="detail-description">{{ row.description }}</td>
                    <td>{{ row.quantityLabel }}</td>
                    <td>{{ row.unitValueLabel }}</td>
                    <td>{{ row.totalValueLabel }}</td>
                    <td>{{ row.criterion }}</td>
                    <td>{{ row.benefit }}</td>
                    <td>{{ row.status }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <nav v-if="pagination.pages > 1" class="pagination" aria-label="Paginação dos itens">
              <button type="button" class="btn btn-ghost btn-small" aria-label="Página anterior dos itens" :disabled="itemPage <= 1" @click="itemPage = Math.max(1, itemPage - 1)">Anterior</button>
              <span>Página {{ Math.min(itemPage, pagination.pages) }} de {{ pagination.pages }}</span>
              <button type="button" class="btn btn-ghost btn-small" aria-label="Próxima página dos itens" :disabled="itemPage >= pagination.pages" @click="itemPage = Math.min(pagination.pages, itemPage + 1)">Próxima</button>
            </nav>
          </template>
          <p v-else class="detail-note">Nenhum item publicado no PNCP.</p>
        </template>
      </section>

      <section v-if="pncp.source === 'pncp'" class="detail-section" aria-labelledby="detail-files">
        <h2 id="detail-files">Arquivos</h2>
        <ul v-if="files.length" class="detail-files">
          <li v-for="(file, index) in files" :key="index" :class="{ superseded: file.superseded }">
            <a v-if="file.href" :href="file.href" target="_blank" rel="noreferrer">{{ file.title }} ↗</a>
            <span v-else>{{ file.title }}</span>
            <small>{{ file.typeName }}<template v-if="file.publishedAt"> · {{ formatDateTime(file.publishedAt) }}</template></small>
            <span v-if="file.superseded" class="deadline-chip tone-closed">Versão anterior</span>
          </li>
        </ul>
        <p v-else class="detail-note">Nenhum arquivo publicado no PNCP.</p>
      </section>

      <EditalAnalysisPanel :opportunity-id="opportunity.id" :source-url="opportunity.sourceUrl" />

      <section class="detail-section" aria-labelledby="detail-about">
        <h2 id="detail-about">Sobre a contratação</h2>
        <p>{{ opportunity.description || 'O edital não trouxe uma descrição complementar.' }}</p>
      </section>
    </article>
  </AppShell>
</template>
