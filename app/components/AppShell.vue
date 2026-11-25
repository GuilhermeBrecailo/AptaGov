<script setup lang="ts">
import type { AuthPayload } from '../types';

defineProps<{
  auth?: AuthPayload | null;
  active: 'panel' | 'agenda' | 'market' | 'configuration' | 'plan' | 'admin' | 'profile';
  contentClass?: string;
}>();

async function logout() {
  await $fetch('/api/auth/logout', { method: 'POST' });
  await navigateTo('/login');
}
</script>

<template>
  <div class="product-shell">
    <div class="app-main">
      <header class="app-topbar">
        <div class="topbar-brand-area">
          <AppNavDrawer :auth="auth" :active="active" @logout="logout" />
          <div class="brand-lockup"><div class="brand-mark">A</div><div><span class="brand-name">AptaGov</span></div></div>
        </div>
        <div class="account-area">
          <button class="topbar-action" type="button" @click="logout">Sair</button>
        </div>
      </header>
      <main class="app-content" :class="contentClass">
        <slot />
      </main>
    </div>
  </div>
</template>
