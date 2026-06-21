<script setup lang="ts">
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
    error.value = 'Invalid username or password.';
  }
}
</script>

<template>
  <div class="max-w-sm mx-auto mt-16">
    <h2 class="text-lg font-semibold mb-4">Sign in</h2>
    <UForm :state="{ username, password }" class="grid gap-3" @submit="submit">
      <UFormGroup label="Username"><UInput v-model="username" autocomplete="username" /></UFormGroup>
      <UFormGroup label="Password"><UInput v-model="password" type="password" autocomplete="current-password" /></UFormGroup>
      <p v-if="error" class="text-sm text-red-500">{{ error }}</p>
      <UButton type="submit" :disabled="!username || !password">Sign in</UButton>
    </UForm>
  </div>
</template>
