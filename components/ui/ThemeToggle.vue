<script setup lang="ts">
import AppIcon from './AppIcon.vue';

defineOptions({ inheritAttrs: false });

// color-mode is configured with dataValue:'theme'. We flip the user's explicit
// preference between 'light' and 'dark'; @nuxtjs/color-mode persists it and
// applies the data-theme attribute for us.
const colorMode = useColorMode();

const isDark = computed(() => colorMode.value === 'dark');

function toggle() {
  colorMode.preference = isDark.value ? 'light' : 'dark';
}
</script>

<template>
  <button
    type="button"
    class="mp-iconbtn mp-theme-toggle"
    :title="isDark ? 'Switch to light theme' : 'Switch to dark theme'"
    :aria-label="isDark ? 'Switch to light theme' : 'Switch to dark theme'"
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
