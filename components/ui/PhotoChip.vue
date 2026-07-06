<script setup lang="ts">
// A translucent dark pill overlaid on a photo (place / viability). Renders EITHER a leading colored
// dot (viability semaphore) OR a leading icon, plus a label. Visuals come from the photo-chip tokens.
import AppIcon from './AppIcon.vue';

defineOptions({ inheritAttrs: false });

withDefaults(
  defineProps<{
    label: string;
    icon?: string;
    // A semaphore dot color token value, e.g. 'var(--photo-dot-good)'. Ignored when `icon` is set.
    dot?: string;
    class?: unknown;
  }>(),
  {},
);
</script>

<template>
  <span :class="['mp-photochip', $props.class]" v-bind="$attrs">
    <AppIcon v-if="icon" :name="icon" :size="13" color="var(--photo-chip-ink)" class="mp-photochip__icon" />
    <span v-else-if="dot" class="mp-photochip__dot" :style="{ background: dot }" />
    <span class="mp-photochip__label">{{ label }}</span>
  </span>
</template>

<style scoped>
.mp-photochip {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  max-width: 100%;
  padding: 3px var(--space-2);
  border-radius: var(--radius-pill);
  background: var(--photo-chip-surface);
  color: var(--photo-chip-ink);
  /* Static blur for extra legibility over busy photos — NOT animated (perf invariant). */
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  font: var(--weight-medium) var(--text-xs) / 1 var(--font-sans);
}

.mp-photochip__icon { flex: none; }

.mp-photochip__dot {
  flex: none;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.28);
}

.mp-photochip__label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
