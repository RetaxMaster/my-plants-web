<script setup lang="ts">
// A small completeness bar: a filled track whose width = filled/total. `label` is the caller-formatted
// text (e.g. "6 of 11 · 55% complete"). One promoted element; the width transitions once on data load
// (never an infinite loop — perf invariant).
defineOptions({ inheritAttrs: false });

const props = withDefaults(
  defineProps<{
    filled: number;
    total: number;
    label?: string;
    class?: unknown;
  }>(),
  {
    label: '',
  },
);

const pct = computed(() => {
  if (props.total <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((props.filled / props.total) * 100)));
});
</script>

<template>
  <div :class="['mp-meter', props.class]" v-bind="$attrs">
    <div
      class="mp-meter__track"
      role="progressbar"
      :aria-valuenow="filled"
      :aria-valuemin="0"
      :aria-valuemax="total"
      :aria-label="label || undefined"
    >
      <div class="mp-meter__fill" :style="{ width: pct + '%' }" />
    </div>
    <span v-if="label" class="mp-meter__label">{{ label }}</span>
  </div>
</template>

<style scoped>
.mp-meter {
  display: grid;
  gap: var(--space-2);
}

.mp-meter__track {
  width: 100%;
  height: 8px;
  border-radius: var(--radius-pill);
  background: var(--surface-sunken);
  overflow: hidden;
}

.mp-meter__fill {
  height: 100%;
  border-radius: var(--radius-pill);
  background: var(--brand-primary);
  transition: width var(--dur-slow) var(--ease-out);
}

.mp-meter__label {
  font: var(--text-xs) / 1.2 var(--font-sans);
  color: var(--text-muted);
}
</style>
