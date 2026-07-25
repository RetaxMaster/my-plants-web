<script setup lang="ts">
import AppIcon from './AppIcon.vue';

defineOptions({ inheritAttrs: false });

const props = withDefaults(
  defineProps<{
    icon?: string;
    // Optional override for the icon's tint — defaults to the brand green used everywhere
    // else. Lets a themed context (e.g. the pantheon/gifted commemorative sections) recolor
    // the icon via a design token instead of forking this component.
    iconColor?: string;
    class?: unknown;
  }>(),
  {
    icon: 'check-circle',
    iconColor: 'var(--green-500)',
  },
);
</script>

<template>
  <div :class="['mp-empty-state', props.class]" v-bind="$attrs">
    <AppIcon :name="icon" :size="18" :color="iconColor" />
    <slot />
  </div>
</template>

<style scoped>
.mp-empty-state {
  display: flex;
  align-items: center;
  gap: 10px;
  justify-content: center;
  padding: 28px 0;
  color: var(--text-muted);
  font: 14px var(--font-sans);
}
</style>
