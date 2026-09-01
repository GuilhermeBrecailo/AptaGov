<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue';
import type { AuthPayload } from '../types';

defineProps<{
  auth?: AuthPayload | null;
  active?: 'panel' | 'configuration' | 'plan' | 'admin';
}>();

const emit = defineEmits<{ logout: [] }>();
const open = ref(false);

function close() {
  open.value = false;
}

function toggle() {
  open.value = !open.value;
}

function handleKeydown(event: globalThis.KeyboardEvent) {
  if (event.key === 'Escape') close();
}

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

  <Transition name="drawer">
    <div v-if="open" class="nav-drawer-backdrop" @click.self="close">
      <aside id="app-navdrawer" class="nav-drawer" aria-label="Menu principal">
        <div class="nav-drawer-head">
          <div>
            <span class="section-kicker">AptaGov</span>
            <strong>Seu espaço de trabalho</strong>
          </div>
          <button class="drawer-close" type="button" aria-label="Fechar menu" @click="close">×</button>
        </div>

        <div class="nav-drawer-account">
          <span class="org-avatar">{{ auth?.organization.name.slice(0, 1).toUpperCase() }}</span>
          <div>
            <strong>{{ auth?.organization.name }}</strong>
            <small>{{ auth?.user.email }}</small>
          </div>
        </div>

        <nav class="nav-drawer-links" aria-label="Seções do aplicativo">
          <NuxtLink class="nav-drawer-link" to="/" exact-active-class="active" @click="close">
            <span class="nav-drawer-icon">▦</span>
            <span><strong>Painel</strong><small>Catálogo e kanban</small></span>
          </NuxtLink>
          <NuxtLink class="nav-drawer-link" to="/configuracao" exact-active-class="active" @click="close">
            <span class="nav-drawer-icon">⚙</span>
            <span><strong>Configuração</strong><small>Filtros, score e notificações</small></span>
          </NuxtLink>
          <NuxtLink class="nav-drawer-link" to="/plano" exact-active-class="active" @click="close">
            <span class="nav-drawer-icon">◇</span>
            <span><strong>Plano</strong><small>Assinatura e limites</small></span>
          </NuxtLink>
          <NuxtLink v-if="auth?.isPlatformAdmin" class="nav-drawer-link admin-link" to="/admin" exact-active-class="active" @click="close">
            <span class="nav-drawer-icon">◈</span>
            <span><strong>Dashboard</strong><small>Visão do negócio</small></span>
          </NuxtLink>
        </nav>

        <div class="nav-drawer-footer">
          <button class="nav-drawer-logout" type="button" @click="emit('logout'); close()">
            <span>↗</span> Sair da conta
          </button>
          <small>Dados e configurações separados por empresa.</small>
        </div>
      </aside>
    </div>
  </Transition>
</template>
