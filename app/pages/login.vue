<script setup lang="ts">
const email = ref('');
const password = ref('');
const errorMessage = ref('');
const pending = ref(false);

async function submit() {
  pending.value = true;
  errorMessage.value = '';
  try {
    await $fetch('/api/auth/login', { method: 'POST', body: { email: email.value, password: password.value } });
    await navigateTo('/');
  } catch (error) {
    errorMessage.value = getApiError(error, 'Não foi possível entrar');
  } finally {
    pending.value = false;
  }
}

function getApiError(error: unknown, fallback: string) {
  if (error && typeof error === 'object' && 'data' in error) {
    const data = error.data;
    if (data && typeof data === 'object' && 'statusMessage' in data && typeof data.statusMessage === 'string') return data.statusMessage;
  }
  return fallback;
}
</script>

<template>
  <main class="auth-shell">
    <section class="auth-intro" aria-label="Sobre o AptaGov">
      <div class="auth-intro-top">
        <div class="auth-brand"><span class="brand-mark">A</span><span><strong>AptaGov</strong><small>Inteligência para vender ao governo</small></span></div>
        <span class="auth-live-status"><i /> Operação simples</span>
      </div>

      <div class="auth-intro-content">
        <span class="auth-kicker">Seu radar de oportunidades</span>
        <h1>Menos busca.<br><em>Mais decisão.</em></h1>
        <p>Encontre licitações aderentes, entenda o score e organize o próximo passo da sua empresa em um só lugar.</p>

        <ul class="auth-benefit-list">
          <li><span class="auth-benefit-number">01</span><span><strong>Descobrir</strong><small>Catálogo do PNCP filtrado para o seu mercado</small></span></li>
          <li><span class="auth-benefit-number">02</span><span><strong>Priorizar</strong><small>Score transparente e ajustável por você</small></span></li>
          <li><span class="auth-benefit-number">03</span><span><strong>Acompanhar</strong><small>Pipeline privado da sua empresa</small></span></li>
        </ul>
      </div>

      <div class="auth-intro-footer"><span>PNCP</span><span class="auth-footer-dot" /> <span>Score por regras</span><span class="auth-footer-dot" /> <span>Kanban da equipe</span></div>
    </section>

    <section class="auth-panel">
      <div class="auth-card">
        <div class="auth-card-head"><span class="auth-card-eyebrow">Acesso da empresa</span><h2>Entrar no Radar</h2><p class="auth-muted">Continue de onde você parou.</p></div>
        <form @submit.prevent="submit">
          <label class="field auth-field"><span>Email corporativo</span><input v-model="email" type="email" autocomplete="email" required placeholder="voce@empresa.com"></label>
          <label class="field auth-field"><span>Senha</span><input v-model="password" type="password" autocomplete="current-password" required placeholder="Digite sua senha"></label>
          <p v-if="errorMessage" class="form-error" role="alert">{{ errorMessage }}</p>
          <button class="btn btn-primary full-button auth-submit" :disabled="pending" type="submit"><span>{{ pending ? 'Entrando…' : 'Entrar na conta' }}</span><span aria-hidden="true">→</span></button>
        </form>
        <p class="auth-security-note"><span aria-hidden="true">✓</span><span>Ambiente privado para os dados da sua empresa.</span></p>
        <p class="auth-switch">Ainda não tem conta? <NuxtLink to="/cadastro">Criar minha conta</NuxtLink></p>
      </div>
      <p class="auth-panel-foot">Ao entrar, você concorda em usar o Radar para acompanhar oportunidades públicas.</p>
    </section>
  </main>
</template>
