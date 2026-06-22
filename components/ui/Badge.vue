<script setup lang="ts">
defineOptions({ inheritAttrs: false });

type Color = 'green' | 'amber' | 'red' | 'cafe' | 'neutral';
type Size = 'xs' | 'sm' | 'md';

const props = withDefaults(
  defineProps<{
    color?: Color;
    size?: Size;
    dot?: boolean;
    class?: unknown;
  }>(),
  {
    color: 'green',
    size: 'sm',
    dot: false,
  },
);
</script>

<template>
  <span :class="['mp-badge', `mp-badge--${color}`, `mp-badge--${size}`, props.class]" v-bind="$attrs">
    <span v-if="dot" class="mp-badge__dot" />
    <slot />
  </span>
</template>

<style scoped>
.mp-badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-family: var(--font-sans);
  font-weight: var(--weight-semibold);
  line-height: 1.2;
  border-radius: var(--radius-pill);
  white-space: nowrap;
}

.mp-badge--xs {
  font-size: var(--text-2xs);
  padding: 2px 7px;
}
.mp-badge--sm {
  font-size: var(--text-xs);
  padding: 3px 9px;
}
.mp-badge--md {
  font-size: var(--text-sm);
  padding: 4px 11px;
}

.mp-badge--green {
  background: var(--care-good-bg);
  color: var(--care-good-text);
}
.mp-badge--amber {
  background: var(--care-caution-bg);
  color: var(--care-caution-text);
}
.mp-badge--red {
  background: var(--care-poor-bg);
  color: var(--care-poor-text);
}
.mp-badge--cafe {
  background: var(--accent-cafe-surface);
  color: var(--accent-cafe-ink);
}
.mp-badge--neutral {
  background: var(--surface-sunken);
  color: var(--text-muted);
}

.mp-badge__dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
  flex: none;
}
</style>
