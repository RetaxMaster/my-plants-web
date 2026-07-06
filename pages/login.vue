<script setup lang="ts">
// The login wall renders without the app navigation (see layouts/auth.vue).
definePageMeta({ layout: 'auth' });

const { t } = useI18n();

useHead(() => ({ title: t('meta.login.title') }));
useSeoMeta({ description: () => t('meta.login.description') });

const username = ref('');
const password = ref('');
const error = ref('');
const route = useRoute();
const { fetch: refreshSession } = useUserSession();

async function submit() {
  error.value = '';
  try {
    await $fetch('/api/auth/login', { method: 'POST', body: { username: username.value, password: password.value } });
    await refreshSession();
    // Only honor an INTERNAL redirect path (defend against open-redirect via ?redirect=//evil.com).
    const raw = (route.query.redirect as string) || '/';
    const redirect = raw.startsWith('/') && !raw.startsWith('//') ? raw : '/';
    await navigateTo(redirect);
  } catch {
    error.value = t('login.invalid');
  }
}
</script>

<template>
  <div>
    <div class="mp-login__intro">
      <h1 class="mp-login__title">{{ $t('login.welcome') }}</h1>
      <p class="mp-login__subtitle">{{ $t('login.subtitle') }}</p>
    </div>

    <form class="mp-form" @submit.prevent="submit">
      <UiFormGroup :label="$t('login.username')">
        <UiInput v-model="username" icon="user" autocomplete="username" :placeholder="$t('login.usernamePlaceholder')" />
      </UiFormGroup>
      <UiFormGroup :label="$t('login.password')" :error="error || undefined">
        <UiInput v-model="password" type="password" autocomplete="current-password" :placeholder="$t('login.passwordPlaceholder')" />
      </UiFormGroup>
      <UiButton type="submit" block :disabled="!username || !password">{{ $t('login.signIn') }}</UiButton>
    </form>
  </div>
</template>

<style scoped>
.mp-login__intro {
  text-align: center;
  margin-bottom: 22px;
}

.mp-login__title {
  font: 800 26px var(--font-sans);
  letter-spacing: -0.02em;
  color: var(--text-strong);
  margin: 0 0 4px;
}

.mp-login__subtitle {
  font: 14px var(--font-sans);
  color: var(--text-muted);
  margin: 0;
}
</style>
