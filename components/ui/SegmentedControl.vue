<script setup lang="ts">
// Generic pill-group segmented control — the ONE implementation behind ES/EN language switching, the
// Write/Split/Read editor mode, and (refactored) LocaleToggle. `size="sm"` reproduces LocaleToggle's
// compact look; the default `md` matches the design bundle's `.mp-seg`.
defineOptions({ inheritAttrs: false });

withDefaults(
  defineProps<{
    options: { key: string; label: string }[];
    ariaLabel?: string;
    size?: 'sm' | 'md';
  }>(),
  { size: 'md' },
);

const model = defineModel<string>({ required: true });

function choose(key: string) {
  if (key !== model.value) model.value = key;
}
</script>

<template>
  <div class="mp-seg" :class="`mp-seg--${size}`" role="group" :aria-label="ariaLabel" v-bind="$attrs">
    <button
      v-for="o in options"
      :key="o.key"
      type="button"
      :class="{ on: o.key === model }"
      :aria-pressed="o.key === model"
      @click="choose(o.key)"
    >
      {{ o.label }}
    </button>
  </div>
</template>

<style scoped>
.mp-seg {
  display: inline-flex;
  gap: 2px;
  background: var(--surface-sunken);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-pill);
  padding: 3px;
}
.mp-seg button {
  border: none;
  background: transparent;
  cursor: pointer;
  border-radius: var(--radius-pill);
  color: var(--text-muted);
  font: var(--weight-semibold) var(--text-sm) var(--font-sans);
  transition: background var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out);
}
.mp-seg--md button { padding: 6px 14px; }
.mp-seg--sm { padding: 2px; }
.mp-seg--sm button { min-width: 34px; padding: 3px 10px; font-size: var(--text-xs); }
.mp-seg button.on {
  background: var(--surface-card);
  color: var(--text-strong);
  box-shadow: var(--shadow-sm);
}
.mp-seg--sm button.on { box-shadow: var(--shadow-xs); }
.mp-seg button:focus-visible {
  outline: none;
  box-shadow: var(--shadow-focus);
}
</style>
