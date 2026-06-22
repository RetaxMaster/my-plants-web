<script setup lang="ts">
defineOptions({ inheritAttrs: false });

const props = withDefaults(
  defineProps<{
    padded?: boolean;
    clickable?: boolean;
    class?: unknown;
  }>(),
  {
    padded: true,
    clickable: false,
  },
);

const slots = useSlots();
const emit = defineEmits<{ click: [MouseEvent] }>();

const isInteractive = computed(() => props.clickable);

function onClick(event: MouseEvent) {
  if (isInteractive.value) emit('click', event);
}
</script>

<template>
  <div
    :class="['mp-card', { 'mp-card--clickable': isInteractive }, props.class]"
    v-bind="$attrs"
    @click="onClick"
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
  </div>
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
