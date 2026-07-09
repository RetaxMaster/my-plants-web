<script setup lang="ts">
import AppIcon from './AppIcon.vue';

defineOptions({ inheritAttrs: false });

type Variant = 'solid' | 'soft' | 'ghost';
type Color = 'primary' | 'cafe' | 'neutral';
type Size = 'xs' | 'sm' | 'md';

const props = withDefaults(
  defineProps<{
    variant?: Variant;
    color?: Color;
    size?: Size;
    icon?: string;
    trailingIcon?: string;
    block?: boolean;
    disabled?: boolean;
    loading?: boolean;
    type?: 'button' | 'submit' | 'reset';
    to?: string;
    class?: unknown;
  }>(),
  {
    variant: 'solid',
    color: 'primary',
    size: 'md',
    type: 'button',
    block: false,
    disabled: false,
    loading: false,
  },
);

defineEmits<{ click: [MouseEvent] }>();

const iconSize = computed(() => ({ xs: 14, sm: 16, md: 18 }[props.size]));
const isDisabled = computed(() => props.disabled || props.loading);
const NuxtLink = resolveComponent('NuxtLink');
const isLink = computed(() => !!props.to);
</script>

<template>
  <component
    :is="isLink ? NuxtLink : 'button'"
    :to="isLink ? to : undefined"
    :type="isLink ? undefined : type"
    :disabled="isLink ? undefined : isDisabled"
    :class="['mp-btn', `mp-btn--${size}`, `mp-btn--${color}-${variant}`, { 'mp-btn--block': block }, props.class]"
    v-bind="$attrs"
    @click="$emit('click', $event)"
  >
    <AppIcon v-if="loading" name="arrow-path" :size="iconSize" class="mp-btn__spinner" />
    <AppIcon v-else-if="icon" :name="icon" :size="iconSize" />
    <slot />
    <AppIcon v-if="trailingIcon && !loading" :name="trailingIcon" :size="iconSize" />
  </component>
</template>

<style scoped>
.mp-btn {
  display: inline-flex;
  width: auto;
  align-items: center;
  justify-content: center;
  font-family: var(--font-sans);
  font-weight: var(--weight-semibold);
  line-height: 1;
  border-radius: var(--radius-md);
  cursor: pointer;
  white-space: nowrap;
  user-select: none;
  /* With `to` this renders a NuxtLink (<a>), which the global `a:hover` rule would underline. */
  text-decoration: none;
  transition:
    filter var(--dur-fast) var(--ease-out),
    transform var(--dur-fast) var(--ease-out);
}

.mp-btn:hover {
  text-decoration: none;
}

.mp-btn--block {
  display: flex;
  width: 100%;
}

.mp-btn:hover:not(:disabled) {
  filter: brightness(0.94);
}

.mp-btn:active:not(:disabled) {
  transform: scale(0.97);
}

.mp-btn:focus-visible {
  outline: none;
  box-shadow: var(--shadow-focus);
}

.mp-btn:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

/* Sizes */
.mp-btn--xs {
  font-size: var(--text-xs);
  padding: 0 var(--space-2);
  height: 28px;
  gap: 4px;
}
.mp-btn--sm {
  font-size: var(--text-sm);
  padding: 0 var(--space-3);
  height: 34px;
  gap: 6px;
}
.mp-btn--md {
  font-size: var(--text-sm);
  padding: 0 var(--space-4);
  height: 40px;
  gap: 8px;
}

/* primary */
.mp-btn--primary-solid {
  background: var(--brand-primary);
  color: var(--text-on-brand);
  border: 1px solid var(--brand-primary);
}
.mp-btn--primary-soft {
  background: var(--brand-primary-subtle);
  color: var(--text-link);
  border: 1px solid transparent;
}
.mp-btn--primary-ghost {
  background: transparent;
  color: var(--text-link);
  border: 1px solid transparent;
}

/* cafe */
.mp-btn--cafe-solid {
  background: var(--brand-accent);
  color: var(--text-on-brand);
  border: 1px solid var(--brand-accent);
}
.mp-btn--cafe-soft {
  background: var(--brand-accent-subtle);
  color: var(--accent-cafe-ink);
  border: 1px solid transparent;
}
.mp-btn--cafe-ghost {
  background: transparent;
  color: var(--accent-cafe-ink);
  border: 1px solid transparent;
}

/* neutral */
.mp-btn--neutral-solid {
  background: var(--surface-inverse);
  color: var(--surface-page);
  border: 1px solid var(--surface-inverse);
}
.mp-btn--neutral-soft {
  background: var(--surface-sunken);
  color: var(--text-body);
  border: 1px solid transparent;
}
.mp-btn--neutral-ghost {
  background: transparent;
  color: var(--text-muted);
  border: 1px solid transparent;
}

.mp-btn__spinner {
  animation: mp-btn-spin 0.7s linear infinite;
}

@keyframes mp-btn-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
