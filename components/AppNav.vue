<script setup lang="ts">
const { loggedIn, user, clear } = useUserSession();

// Protected destinations require a session; only the blog is public. When logged
// out we hide the protected links so a visitor never clicks a link that just
// bounces them back to /login.
const allLinks = [
  { label: 'Today', to: '/', icon: 'i-heroicons-sun', public: false },
  { label: 'Plants', to: '/plants', icon: 'i-heroicons-sparkles', public: false },
  { label: 'Places', to: '/places', icon: 'i-heroicons-home', public: false },
  { label: 'Cities', to: '/cities', icon: 'i-heroicons-map-pin', public: false },
  { label: 'Moving', to: '/moving', icon: 'i-heroicons-truck', public: false },
  { label: 'Blog', to: '/blog', icon: 'i-heroicons-book-open', public: true },
];
const links = computed(() => (loggedIn.value ? allLinks : allLinks.filter((l) => l.public)));

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
    <UButton v-else class="ml-auto" size="xs" to="/login" icon="i-heroicons-arrow-right-on-rectangle" variant="ghost" color="gray">Sign in</UButton>
  </nav>
</template>
