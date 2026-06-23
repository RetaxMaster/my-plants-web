<script setup lang="ts">
defineOptions({ inheritAttrs: false });

const props = withDefaults(
  defineProps<{
    padded?: boolean;
    clickable?: boolean;
    // When set, the card IS a navigation link: it renders as a <NuxtLink> so it
    // gets real href semantics (Cmd/Ctrl-click, open-in-new-tab, screen-reader
    // link behavior). Prefer this over `clickable` for cards that navigate.
    to?: string;
    class?: unknown;
  }>(),
  {
    padded: true,
    clickable: false,
  },
);

const slots = useSlots();
const emit = defineEmits<{ click: [MouseEvent | KeyboardEvent] }>();

// A `to` link is inherently interactive; `clickable` is the action-card path.
const isLink = computed(() => !!props.to);
const isInteractive = computed(() => props.clickable && !isLink.value);

function onClick(event: MouseEvent) {
  if (isInteractive.value) emit('click', event);
}

// Action cards (no `to`) are <div>s, so they need explicit keyboard activation:
// Enter/Space fire the same click the mouse does, matching native button behavior.
function onKeydown(event: KeyboardEvent) {
  if (!isInteractive.value) return;
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    emit('click', event);
  }
}
</script>

<template>
  <component
    :is="isLink ? 'NuxtLink' : 'div'"
    :to="isLink ? to : undefined"
    :class="['mp-card', { 'mp-card--clickable': isInteractive || isLink, 'mp-card--link': isLink }, props.class]"
    :role="isInteractive ? 'button' : undefined"
    :tabindex="isInteractive ? 0 : undefined"
    v-bind="$attrs"
    @click="onClick"
    @keydown="onKeydown"
  >
    <div v-if="slots.header" class="mp-card__header">
      <slot name="header" />
    </div>
    <div :class="['mp-card__body', { 'mp-card__body--padded': padded }]">
      <slot />
    </div>
    <div v-if="slots.footer" class="mp-card__footer">
      <slot name="footer" />
    </div>
  </component>
</template>

<style scoped>
.mp-card {
  background: var(--surface-card);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-sm);
  overflow: hidden;
  transition:
    box-shadow var(--dur-normal) var(--ease-out),
    transform var(--dur-normal) var(--ease-out);
}

.mp-card--clickable {
  cursor: pointer;
}

.mp-card--clickable:hover {
  box-shadow: var(--shadow-md);
  transform: translateY(-1px);
}

/* When the card is a NuxtLink (<a>) it must look like the block card, not a link:
   no underline, inherit text color, full-width block, and the same hover lift. */
.mp-card--link {
  display: block;
  text-decoration: none;
  color: inherit;
  cursor: pointer;
}

.mp-card--link:hover {
  box-shadow: var(--shadow-md);
  transform: translateY(-1px);
}

.mp-card--clickable:focus-visible,
.mp-card--link:focus-visible {
  outline: none;
  box-shadow: var(--shadow-focus);
}

.mp-card__header {
  padding: var(--space-3) var(--space-4);
  border-bottom: 1px solid var(--border-subtle);
}

.mp-card__body--padded {
  padding: var(--space-4);
}

.mp-card__footer {
  padding: var(--space-3) var(--space-4);
  border-top: 1px solid var(--border-subtle);
  background: var(--stone-50);
}
</style>
