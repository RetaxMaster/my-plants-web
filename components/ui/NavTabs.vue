<script setup lang="ts">
import AppIcon from './AppIcon.vue';

defineOptions({ inheritAttrs: false });

interface Item {
  key: string;
  label: string;
  icon: string;
  to: string;
}

const props = withDefaults(
  defineProps<{
    items?: Item[];
    active?: string;
    variant?: 'top' | 'bottom';
  }>(),
  {
    items: () => [],
    variant: 'top',
  },
);

const emit = defineEmits<{ select: [string] }>();

function iconFor(item: Item, on: boolean): string {
  // Bottom bar uses the solid variant for the active item.
  return props.variant === 'bottom' && on ? `solid/${item.icon}` : item.icon;
}
</script>

<template>
  <nav :class="['mp-navtabs', `mp-navtabs--${variant}`]" v-bind="$attrs">
    <!-- Real links (NuxtLink → <a href>) restore href semantics: Cmd/Ctrl-click,
         context-menu "open in new tab", and screen-reader link behavior. We keep
         the `select` event so existing parents can still react, but navigation now
         comes from the href, not JS. -->
    <NuxtLink
      v-for="item in props.items"
      :key="item.key"
      :to="item.to"
      :class="['mp-navtabs__item', { 'mp-navtabs__item--active': item.key === active }]"
      :aria-current="item.key === active ? 'page' : undefined"
      @click="emit('select', item.key)"
    >
      <AppIcon
        :name="iconFor(item, item.key === active)"
        :size="variant === 'bottom' ? 22 : 18"
      />
      <span class="mp-navtabs__label">{{ item.label }}</span>
    </NuxtLink>
  </nav>
</template>

<style scoped>
.mp-navtabs {
  display: flex;
}

/* Items are now <a> (NuxtLink); strip the default link underline/color so they
   keep the ghost-tab look. Per-variant rules below set color/layout. */
.mp-navtabs__item {
  text-decoration: none;
}

/* top: horizontal ghost-button row */
.mp-navtabs--top {
  gap: var(--space-1);
  border-bottom: 1px solid var(--border-subtle);
  padding: var(--space-2) var(--space-1);
  overflow-x: auto;
}

.mp-navtabs--top .mp-navtabs__item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-md);
  background: transparent;
  border: none;
  cursor: pointer;
  white-space: nowrap;
  color: var(--text-muted);
  font-family: var(--font-sans);
  font-size: var(--text-sm);
  font-weight: var(--weight-semibold);
  transition: background var(--dur-fast) var(--ease-out);
}

.mp-navtabs--top .mp-navtabs__item--active {
  background: var(--nav-active-bg);
  color: var(--nav-active-text);
}

/* bottom: fixed mobile tab bar (icon over label) */
.mp-navtabs--bottom {
  justify-content: space-around;
  align-items: stretch;
  background: var(--surface-card);
  border-top: 1px solid var(--border-subtle);
  padding: var(--space-1) var(--space-1) calc(var(--space-1) + env(safe-area-inset-bottom, 0px));
}

.mp-navtabs--bottom .mp-navtabs__item {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: var(--space-2) 0;
  background: none;
  border: none;
  cursor: pointer;
  color: var(--nav-idle);
  font-family: var(--font-sans);
  font-size: var(--text-2xs);
  font-weight: var(--weight-medium);
}

.mp-navtabs--bottom .mp-navtabs__item--active {
  color: var(--nav-active-text);
}

.mp-navtabs--bottom .mp-navtabs__item--active .mp-navtabs__label {
  font-weight: var(--weight-semibold);
}

.mp-navtabs__item:focus-visible {
  outline: none;
  box-shadow: var(--shadow-focus);
}
</style>
