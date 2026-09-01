<script setup lang="ts">
import RadarEditor from '../components/RadarEditor.vue';
import RadarList from '../components/RadarList.vue';
import type { AuthPayload, FilterConfig, NotificationSettings, SavedSearch, SyncSettings } from '../types';

const {
  canInstall,
  isIos,
  requiresPwaForNotifications,
  notificationPermission,
  notificationsEnabled,
  notificationError,
  enableNotifications,
  install,
  refreshInstallState,
} = usePwa();
const { data: auth, error: authError } = await useFetch<AuthPayload>('/api/auth/me');
if (authError.value) await navigateTo('/login');

const { data: filters, refresh: refreshFilters } = await useFetch<FilterConfig>('/api/filters');
const { data: notification, refresh: refreshNotification } = await useFetch<NotificationSettings>('/api/notifications');
const { data: syncSettings, refresh: refreshSyncSettings } = await useFetch<SyncSettings>('/api/sync-settings');
const { data: radarPayload, refresh: refreshRadars } = await useFetch<{ data: SavedSearch[]; limit: number | null }>('/api/radars', {
  default: () => ({ data: [], limit: 3 }),
});
const message = ref('');
const savingSyncSettings = ref(false);
const editingRadar = ref<SavedSearch | null>(null);
const creatingRadar = ref(false);

type ListFilterKey = 'keywords' | 'excludedKeywords' | 'states' | 'citiesIbge' | 'modalities';

function updateList(key: ListFilterKey, event: Event) {
  if (!filters.value) return;
  filters.value[key] = String((event.target as HTMLTextAreaElement).value)
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function listValue(key: ListFilterKey): string {
  return filters.value?.[key].join(', ') ?? '';
}

async function saveFilters() {
  if (!filters.value) return;
  await $fetch('/api/filters', { method: 'PUT', body: filters.value });
  message.value = 'Configurações do radar salvas.';
  await refreshFilters();
}

async function saveNotifications() {
  if (!notification.value) return;
  await $fetch('/api/notifications', {
    method: 'PUT',
    body: { enabled: notification.value.enabled, email: notification.value.email },
  });
  message.value = 'Preferências de alertas salvas.';
  await refreshNotification();
}

async function saveSyncSettings() {
  if (!syncSettings.value || auth.value?.role !== 'OWNER') return;
  savingSyncSettings.value = true;
  try {
    await $fetch('/api/sync-settings', {
      method: 'PUT',
      body: { enabled: syncSettings.value.enabled },
    });
    message.value = syncSettings.value.enabled
      ? 'Busca automática ativada.'
      : 'Busca automática desativada. A sincronização manual continua disponível.';
    await refreshSyncSettings();
  } catch (error) {
    message.value = error instanceof Error ? error.message : 'Não foi possível salvar a busca automática.';
  } finally {
    savingSyncSettings.value = false;
  }
}

function openRadarEditor(radar?: SavedSearch) {
  editingRadar.value = radar ?? null;
  creatingRadar.value = !radar;
}

function closeRadarEditor() {
  editingRadar.value = null;
  creatingRadar.value = false;
}

async function saveRadar(payload: { id?: number; name: string; filters: FilterConfig; enabled: boolean }) {
  try {
    if (payload.id) await $fetch(`/api/radars/${payload.id}`, { method: 'PATCH', body: payload });
    else await $fetch('/api/radars', { method: 'POST', body: payload });
    message.value = 'Radar salvo.';
    closeRadarEditor();
    await refreshRadars();
  } catch (error) {
    message.value = error instanceof Error ? error.message : 'Não foi possível salvar o radar.';
  }
}

async function toggleRadar(radar: SavedSearch) {
  await $fetch(`/api/radars/${radar.id}`, { method: 'PATCH', body: { enabled: !radar.enabled } });
  message.value = radar.enabled ? 'Radar pausado.' : 'Radar ativado.';
  await refreshRadars();
}

async function removeRadar(radar: SavedSearch) {
  if (!globalThis.confirm(`Excluir o radar “${radar.name}”?`)) return;
  await $fetch(`/api/radars/${radar.id}`, { method: 'DELETE' });
  message.value = 'Radar excluído.';
  await refreshRadars();
}

async function enableDeviceNotifications() {
  const enabled = await enableNotifications();
  message.value = enabled ? 'Notificações do dispositivo ativadas.' : notificationError.value;
}

async function installPwa() {
  await install();
  refreshInstallState();
}

function verifyPwaInstallation() {
  refreshInstallState();
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
        <AppNavDrawer :auth="auth" active="configuration" @logout="logout" />
        <div class="brand-lockup"><div class="brand-mark">A</div><div><span class="brand-name">AptaGov</span><span class="brand-caption">Inteligência para vender ao governo</span></div></div>
      </div>
      <div class="account-area"><span class="user-name">{{ auth?.user.name }}</span><button class="topbar-action" type="button" @click="logout">Sair</button></div>
    </header>

    <main class="app-content configuration-page">
      <div class="app-heading">
        <div><span class="section-kicker">Preferências da empresa</span><h1>Configuração</h1><p>Defina o que entra no seu radar e como você quer receber os alertas.</p></div>
        <NuxtLink class="btn btn-ghost" to="/">Voltar ao painel</NuxtLink>
      </div>
      <div v-if="message" class="notice">{{ message }}</div>

      <div v-if="filters" class="configuration-layout">
        <section class="content-surface configuration-surface radar-management-surface">
          <RadarList :radars="radarPayload?.data ?? []" :limit="radarPayload?.limit ?? 3" @create="openRadarEditor()" @edit="openRadarEditor" @toggle="toggleRadar" @remove="removeRadar" />
        </section>
        <RadarEditor v-if="creatingRadar || editingRadar" :radar="editingRadar" :filters="filters" @save="saveRadar" @close="closeRadarEditor" />
        <section class="content-surface configuration-surface">
          <div class="list-heading"><div><span class="section-kicker">Filtros do catálogo</span><h2>O que merece sua atenção</h2></div><span class="configuration-scope">Exclusivo da sua empresa</span></div>
          <div class="configuration-grid">
            <label class="field field-wide"><span>Palavras-chave</span><textarea :value="listValue('keywords')" placeholder="Ex.: software, manutenção, suporte" @change="updateList('keywords', $event)" /><small>Separe por vírgulas. Uma licitação pode combinar mais de um termo.</small></label>
            <label class="field field-wide"><span>Palavras excluídas</span><textarea :value="listValue('excludedKeywords')" placeholder="Ex.: obra, combustível" @change="updateList('excludedKeywords', $event)" /><small>Termos que tiram uma oportunidade dos resultados.</small></label>
            <label class="field"><span>Estados</span><textarea :value="listValue('states')" placeholder="SP, RJ, MG" @change="updateList('states', $event)" /></label>
            <label class="field"><span>Cidades (código IBGE)</span><textarea :value="listValue('citiesIbge')" placeholder="3550308" @change="updateList('citiesIbge', $event)" /></label>
            <label class="field"><span>Modalidades</span><textarea :value="listValue('modalities')" placeholder="Pregão, concorrência" @change="updateList('modalities', $event)" /></label>
            <label class="field"><span>Período de busca (dias)</span><input v-model.number="filters.lookbackDays" type="number" min="1" max="365"></label>
            <label class="field"><span>Score mínimo para exibir</span><input v-model.number="filters.minimumScore" type="number" min="0" max="100"><small>De 0 a 100, conforme a aderência calculada.</small></label>
            <label class="field"><span>Valor mínimo estimado (centavos)</span><input v-model.number="filters.estimatedValueMinCents" type="number" min="0"></label>
          </div>
          <button class="btn btn-dark" type="button" @click="saveFilters">Salvar filtros</button>
        </section>

        <section class="content-surface configuration-surface">
          <div class="list-heading"><div><span class="section-kicker">Ajuste fino</span><h2>Peso do score</h2></div></div>
          <p class="configuration-help">Aumente o peso dos critérios que mais importam para a sua empresa. O próximo ciclo usará os novos valores.</p>
          <div class="weight-grid configuration-weight-grid">
            <label class="field"><span>Peso de palavras-chave</span><input v-model.number="filters.scoreWeights.keyword" type="number" min="0" max="100"></label>
            <label class="field"><span>Região</span><input v-model.number="filters.scoreWeights.region" type="number" min="0" max="100"></label>
            <label class="field"><span>Prazo</span><input v-model.number="filters.scoreWeights.deadline" type="number" min="0" max="100"></label>
            <label class="field"><span>Valor</span><input v-model.number="filters.scoreWeights.value" type="number" min="0" max="100"></label>
          </div>
          <button class="btn btn-dark" type="button" @click="saveFilters">Salvar pesos</button>
        </section>

        <section v-if="syncSettings" class="content-surface configuration-surface">
          <div class="list-heading"><div><span class="section-kicker">Monitoramento</span><h2>Busca automática de licitações</h2></div><span class="configuration-scope">A cada {{ syncSettings.intervalMinutes }} {{ syncSettings.intervalMinutes === 1 ? 'minuto' : 'minutos' }}</span></div>
          <div class="configuration-notification">
            <label class="toggle-field"><input v-model="syncSettings.enabled" type="checkbox" :disabled="auth?.role !== 'OWNER'"><span>Habilitar busca automática</span></label>
            <p class="configuration-help">Ligada: o worker consulta novas licitações a cada {{ syncSettings.intervalMinutes }} minutos e prepara os alertas. Desligada: somente o botão “Sincronizar PNCP” faz uma nova busca para esta empresa.</p>
            <button v-if="auth?.role === 'OWNER'" class="btn btn-outline" type="button" :disabled="savingSyncSettings" @click="saveSyncSettings">{{ savingSyncSettings ? 'Salvando…' : 'Salvar preferência' }}</button>
            <small v-else>Apenas o proprietário da empresa pode alterar esta preferência.</small>
          </div>
        </section>

        <section v-if="notification" class="content-surface configuration-surface">
          <div class="list-heading"><div><span class="section-kicker">Alertas</span><h2>Como você quer ser avisado</h2></div></div>
          <div class="configuration-notification">
            <label class="toggle-field"><input v-model="notification.enabled" type="checkbox"><span>Ativar alertas por e-mail</span></label>
            <div class="notification-input"><input v-model="notification.email" type="email" aria-label="E-mail de destino" placeholder="voce@empresa.com"><button class="btn btn-outline" type="button" @click="saveNotifications">Salvar</button></div>
            <small>O envio respeita o limite do seu plano e não duplica a mesma licitação.</small>
          </div>
        </section>

        <section class="content-surface configuration-surface">
          <div class="list-heading"><div><span class="section-kicker">Avisos no dispositivo</span><h2>Notificações no celular e computador</h2></div></div>
          <div class="device-notification-card configuration-device-notification">
            <div>
              <p v-if="requiresPwaForNotifications"><strong>Para receber notificações no celular, use o AptaGov instalado.</strong></p>
              <p v-else>Receba um aviso mesmo quando o AptaGov estiver fechado. O navegador pedirá sua permissão na primeira ativação.</p>
              <p v-if="requiresPwaForNotifications" class="pwa-install-steps">
                <template v-if="isIos">No iPhone ou iPad: toque em Compartilhar, escolha “Adicionar à Tela de Início”, abra o AptaGov pelo ícone e volte aqui.</template>
                <template v-else>Toque em “Instalar AptaGov” ou abra o menu do navegador e escolha “Instalar aplicativo”. Depois, abra o AptaGov pelo ícone.</template>
              </p>
            </div>
            <div class="device-notification-action">
              <template v-if="requiresPwaForNotifications">
                <button v-if="canInstall" class="btn btn-primary" type="button" @click="installPwa">Instalar AptaGov</button>
                <button v-else class="btn btn-outline" type="button" @click="verifyPwaInstallation">Já instalei, verificar</button>
                <small>O botão de ativação aparece depois que o PWA estiver aberto.</small>
              </template>
              <template v-else>
                <button v-if="!notificationsEnabled && notificationPermission !== 'denied' && notificationPermission !== 'unsupported'" class="btn btn-primary" type="button" @click="enableDeviceNotifications">Ativar notificações</button>
                <span v-else-if="notificationsEnabled" class="device-notification-enabled">✓ Notificações ativadas</span>
                <span v-else-if="notificationPermission === 'denied'" class="device-notification-blocked">Notificações bloqueadas nas configurações do navegador. Libere a permissão para este site e tente novamente.</span>
                <span v-else class="device-notification-blocked">Notificações não disponíveis neste dispositivo.</span>
              </template>
              <small v-if="notificationError && notificationPermission !== 'denied'">{{ notificationError }}</small>
            </div>
          </div>
        </section>
      </div>
    </main>
  </div>
</template>
