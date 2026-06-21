<script setup lang="ts">
const links = [
  { label: 'Today', to: '/', icon: 'i-heroicons-sun' },
  { label: 'Plants', to: '/plants', icon: 'i-heroicons-sparkles' },
  { label: 'Places', to: '/places', icon: 'i-heroicons-home' },
  { label: 'Cities', to: '/cities', icon: 'i-heroicons-map-pin' },
  { label: 'Moving', to: '/moving', icon: 'i-heroicons-truck' },
  { label: 'Blog', to: '/blog', icon: 'i-heroicons-book-open' },
];

const { loggedIn, user, clear } = useUserSession();

async function logout() {
  await $fetch('/api/auth/logout', { method: 'POST' });
  await clear();
  await navigateTo('/login');
}
</script>

<template>
  <nav class="flex items-center gap-1 border-b border-gray-200 px-4 py-2">
    <UButton v-for="l in links" :key="l.to" :to="l.to" :icon="l.icon" variant="ghost" color="gray">{{ l.label }}</UButton>
    <span v-if="loggedIn" class="ml-auto flex items-center gap-2 text-sm">
      <span class="text-gray-500">{{ user?.username }}</span>
      <UButton size="xs" variant="ghost" color="gray" @click="logout">Log out</UButton>
    </span>
  </nav>
</template>
