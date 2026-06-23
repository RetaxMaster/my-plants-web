<script setup lang="ts">
import AppIcon from './AppIcon.vue';

defineOptions({ inheritAttrs: false });

// color-mode is configured with dataValue:'theme'. We flip the user's explicit
// preference between 'light' and 'dark'; @nuxtjs/color-mode persists it and
// applies the data-theme attribute for us.
const colorMode = useColorMode();

const isDark = computed(() => colorMode.value === 'dark');

// Hydration safety. The server never knows the user's persisted theme, so SSR
// always renders the default (light) markup; the client resolves the real theme
// BEFORE Vue hydrates, so any theme-dependent markup outside <ClientOnly> differs
// between the two and Vue logs a hydration mismatch on every page. The icon is
// already shielded by <ClientOnly> (a server fallback that only swaps in after
// mount). The button's title/aria-label live on the outer <button>, which can't
// go inside <ClientOnly>, so we apply the SAME idea by hand: a `mounted` flag that
// is false during SSR AND the first client render (so both sides match: the
// neutral "Switch to dark theme") and flips to true in onMounted, after which the
// label reflects the real theme. This is deterministic and independent of when
// color-mode resolves, so hydration stays clean with no FOUC.
const mounted = ref(false);
onMounted(() => {
  mounted.value = true;
});
const label = computed(() =>
  mounted.value && isDark.value ? 'Switch to light theme' : 'Switch to dark theme',
);

function toggle() {
  colorMode.preference = isDark.value ? 'light' : 'dark';
}
</script>

<template>
  <button
    type="button"
    class="mp-iconbtn mp-theme-toggle"
    :title="label"
    :aria-label="label"
    v-bind="$attrs"
    @click="toggle"
  >
    <ClientOnly>
      <AppIcon :name="isDark ? 'sun' : 'moon'" :size="17" color="var(--text-muted)" />
      <template #fallback>
        <AppIcon name="moon" :size="17" color="var(--text-muted)" />
      </template>
    </ClientOnly>
  </button>
</template>

<style scoped>
.mp-theme-toggle {
  background: var(--surface-sunken);
  border: 1px solid var(--border-subtle);
}
</style>
