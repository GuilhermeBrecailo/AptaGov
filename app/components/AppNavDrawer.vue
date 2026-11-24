<script setup lang="ts">
import { onBeforeUnmount, onMounted, watch } from 'vue';
import { useRoute } from 'vue-router';
import type { AuthPayload } from '../types';

defineProps<{
  auth?: AuthPayload | null;
  active?: 'panel' | 'agenda' | 'market' | 'configuration' | 'plan' | 'admin';
}>();

const emit = defineEmits<{ logout: [] }>();
const open = ref(false);
const route = useRoute();

// Ícones de traço simples (24x24), desenhados para a navegação.
const icons = {
  panel: 'M4 5h16M4 12h16M4 19h10',
  agenda: 'M7 3v3M17 3v3M4 9h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z',
  market: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  configuration: 'M4 7h10M18 7h2M4 17h4M12 17h8M16 5v4M10 15v4',
  plan: 'M3 7h18v12H3zM3 11h18',
  admin: 'M12 3 4 6v6c0 4.5 3.4 8 8 9 4.6-1 8-4.5 8-9V6l-8-3Z',
} as const;

function close() {
  open.value = false;
}

function toggle() {
  open.value = !open.value;
}

function handleKeydown(event: globalThis.KeyboardEvent) {
  if (event.key === 'Escape') close();
}

watch(() => route.fullPath, close);
onMounted(() => globalThis.addEventListener('keydown', handleKeydown));
onBeforeUnmount(() => globalThis.removeEventListener('keydown', handleKeydown));
</script>

<template>
  <button
    class="menu-toggle"
    type="button"
    aria-label="Abrir menu"
    :aria-expanded="open"
    aria-controls="app-navdrawer"
    @click="toggle"
  >
    <span class="hamburger-lines" aria-hidden="true"><i /><i /><i /></span>
  </button>

  <div class="nav-drawer-backdrop" :class="{ open }" aria-hidden="true" @click="close" />
  <aside id="app-navdrawer" class="nav-drawer" :class="{ open }" aria-label="Menu principal">
    <div class="nav-drawer-head">
      <NuxtLink class="brand-lockup" to="/">
        <span class="brand-mark">A</span>
        <span class="brand-name">AptaGov</span>
      </NuxtLink>
      <button class="drawer-close" type="button" aria-label="Fechar menu" @click="close">×</button>
    </div>

    <nav class="nav-drawer-links" aria-label="Seções do aplicativo">
      <NuxtLink class="nav-drawer-link" to="/" exact-active-class="active">
        <svg class="nav-drawer-icon" viewBox="0 0 24 24" aria-hidden="true"><path :d="icons.panel" /></svg>
        <strong>Painel</strong>
      </NuxtLink>
      <NuxtLink class="nav-drawer-link" to="/agenda" exact-active-class="active">
        <svg class="nav-drawer-icon" viewBox="0 0 24 24" aria-hidden="true"><path :d="icons.agenda" /></svg>
        <strong>Agenda</strong>
      </NuxtLink>
      <NuxtLink class="nav-drawer-link" to="/mercado" exact-active-class="active">
        <svg class="nav-drawer-icon" viewBox="0 0 24 24" aria-hidden="true"><path :d="icons.market" /></svg>
        <strong>Mercado</strong>
      </NuxtLink>
    </nav>

    <nav class="nav-drawer-links nav-drawer-secondary" aria-label="Conta e preferências">
      <NuxtLink class="nav-drawer-link" to="/configuracao" exact-active-class="active">
        <svg class="nav-drawer-icon" viewBox="0 0 24 24" aria-hidden="true"><path :d="icons.configuration" /></svg>
        <strong>Configuração</strong>
      </NuxtLink>
      <NuxtLink class="nav-drawer-link" to="/plano" exact-active-class="active">
        <svg class="nav-drawer-icon" viewBox="0 0 24 24" aria-hidden="true"><path :d="icons.plan" /></svg>
        <strong>Plano</strong>
      </NuxtLink>
      <NuxtLink v-if="auth?.isPlatformAdmin" class="nav-drawer-link admin-link" to="/admin" exact-active-class="active">
        <svg class="nav-drawer-icon" viewBox="0 0 24 24" aria-hidden="true"><path :d="icons.admin" /></svg>
        <strong>Dashboard</strong>
      </NuxtLink>
    </nav>

    <div class="nav-drawer-footer">
      <div class="nav-drawer-account">
        <span class="org-avatar">{{ auth?.organization.name.slice(0, 1).toUpperCase() }}</span>
        <div>
          <strong>{{ auth?.organization.name }}</strong>
          <small>{{ auth?.user.email }}</small>
        </div>
      </div>
      <button class="nav-drawer-logout" type="button" @click="emit('logout'); close()">Sair da conta</button>
    </div>
  </aside>
</template>
