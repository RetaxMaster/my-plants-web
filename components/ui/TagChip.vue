<script setup lang="ts">
import type { ProgressTagGroup } from '../../types/api.js';

const props = withDefaults(
  defineProps<{
    label: string;
    group: ProgressTagGroup;
    active?: boolean;
    readonly?: boolean;
  }>(),
  { active: false, readonly: false },
);

const emit = defineEmits<{ toggle: [] }>();
const onClick = () => { if (!props.readonly) emit('toggle'); };

// Alias the `readonly` prop for the template: a bare `readonly` there resolves to Vue's auto-imported
// reactivity helper (always truthy), not the prop — so reference it through these computeds instead.
const chipReadonly = computed(() => props.readonly);
</script>

<template>
  <button
    type="button"
    class="mp-chip"
    :class="[`mp-chip--${group}`, { 'mp-chip--active': active, 'mp-chip--readonly': chipReadonly }]"
    :aria-pressed="chipReadonly ? undefined : active"
    :disabled="chipReadonly ? !active : false"
    @click="onClick"
  >
    {{ label }}
  </button>
</template>

<style scoped>
.mp-chip {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  padding: var(--space-1) var(--space-3);
  font-family: var(--font-sans);
  font-size: var(--text-xs);
  font-weight: var(--weight-medium);
  color: var(--text-strong);
  background: var(--surface-card);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-pill);
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease-out), border-color var(--dur-fast) var(--ease-out);
}

.mp-chip:focus-visible {
  outline: none;
  box-shadow: var(--shadow-focus);
}

.mp-chip--readonly {
  cursor: default;
}

/* Positive/neutral active: brand-tinted. */
.mp-chip--positive.mp-chip--active {
  background: var(--surface-sunken);
  border-color: var(--border-brand);
  color: var(--text-brand);
}

/* Negative active: danger-tinted from the red token scale (mirrors the screenshots' red chips). */
.mp-chip--negative.mp-chip--active {
  background: var(--red-50);
  border-color: var(--red-500);
  color: var(--red-700);
}
</style>
