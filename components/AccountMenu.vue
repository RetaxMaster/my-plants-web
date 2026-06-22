<script setup lang="ts">
import AppIcon from './ui/AppIcon.vue';

// AccountMenu is rendered only when there is a session (the layout guards this),
// so the dropdown always has a username to show.
const { user, clear } = useUserSession();

// The session carries only identity. The primary city is derived from the API —
// never assumed to live in auth state, never raw-fetched outside useApi.
const api = useApi();
const { data: cities } = await useAsyncData('account-cities', () => api.listCities(), {
  default: () => [],
});

const primaryCity = computed(() => {
  const primary = cities.value?.find((c) => c.isPrimary);
  return primary ? primary.name : 'No primary city';
});

const open = ref(false);
const root = ref<HTMLElement | null>(null);

function toggle() {
  open.value = !open.value;
}

function onDocumentClick(event: MouseEvent) {
  if (root.value && !root.value.contains(event.target as Node)) open.value = false;
}

onMounted(() => document.addEventListener('click', onDocumentClick));
onBeforeUnmount(() => document.removeEventListener('click', onDocumentClick));

// Mirror AppNav's logout exactly: drop the bearer server-side, clear the sealed
// session client-side, then bounce to the login wall.
async function logout() {
  open.value = false;
  await $fetch('/api/auth/logout', { method: 'POST' });
  await clear();
  await navigateTo('/login');
}
</script>

<template>
  <div ref="root" class="mp-account">
    <button
      type="button"
      class="mp-iconbtn mp-account__trigger"
      title="Account"
      aria-label="Account"
      :aria-expanded="open"
      @click="toggle"
    >
      <AppIcon name="user" :size="18" color="var(--accent-cafe-ink)" />
    </button>

    <div v-if="open" class="mp-menu">
      <div class="mp-account__identity">
        <div class="mp-account__name">{{ user?.username }}</div>
        <div class="mp-account__city">{{ primaryCity }}</div>
      </div>
      <button type="button" class="mp-menu-item" @click="logout">
        <AppIcon name="arrow-right-on-rectangle" :size="16" color="currentColor" />
        Sign out
      </button>
    </div>
  </div>
</template>

<style scoped>
.mp-account {
  position: relative;
}

.mp-account__trigger {
  background: var(--accent-cafe-surface);
}

.mp-account__identity {
  padding: 4px 10px 8px;
  border-bottom: 1px solid var(--border-subtle);
  margin-bottom: 4px;
}

.mp-account__name {
  font: 700 14px var(--font-sans);
  color: var(--text-strong);
}

.mp-account__city {
  font: 12px var(--font-sans);
  color: var(--text-muted);
}
</style>
