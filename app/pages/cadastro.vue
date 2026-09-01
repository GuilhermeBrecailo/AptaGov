<script setup lang="ts">
const name = ref('');
const organizationName = ref('');
const email = ref('');
const password = ref('');
const errorMessage = ref('');
const pending = ref(false);

async function submit() {
  pending.value = true;
  errorMessage.value = '';
  try {
    await $fetch('/api/auth/signup', { method: 'POST', body: { name: name.value, organizationName: organizationName.value, email: email.value, password: password.value } });
    await navigateTo('/boas-vindas');
  } catch (error) {
    errorMessage.value = getApiError(error, 'Não foi possível criar a conta');
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
  <main class="auth-shell"><section class="auth-intro"><div class="brand-mark">A</div><span class="auth-kicker">AptaGov</span><h1>Comece a transformar oportunidades em pipeline.</h1><p>Encontre licitações aderentes e personalize sua operação em poucos minutos.</p></section><section class="auth-card"><span class="section-kicker">Primeiro passo</span><h2>Criar sua conta</h2><p class="auth-muted">Você começa com um espaço exclusivo para sua empresa.</p><form @submit.prevent="submit"><label class="field"><span>Seu nome</span><input v-model="name" type="text" autocomplete="name" required placeholder="Ana Silva"></label><label class="field"><span>Nome da empresa</span><input v-model="organizationName" type="text" autocomplete="organization" required placeholder="Empresa Silva Ltda."></label><label class="field"><span>Email</span><input v-model="email" type="email" autocomplete="email" required placeholder="voce@empresa.com"></label><label class="field"><span>Senha</span><input v-model="password" type="password" autocomplete="new-password" minlength="8" required placeholder="Mínimo de 8 caracteres"></label><p v-if="errorMessage" class="form-error">{{ errorMessage }}</p><button class="btn btn-primary full-button" :disabled="pending" type="submit">{{ pending ? 'Criando conta…' : 'Criar minha conta' }}</button></form><p class="auth-switch">Já tem uma conta? <NuxtLink to="/login">Entrar</NuxtLink></p></section></main>
</template>
