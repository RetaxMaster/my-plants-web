<script setup lang="ts">
import AppIcon from './AppIcon.vue';

defineOptions({ inheritAttrs: false });

const props = withDefaults(
  defineProps<{
    icon?: string;
    class?: unknown;
  }>(),
  {
    icon: 'check-circle',
  },
);
</script>

<template>
  <div :class="['mp-empty-state', props.class]" v-bind="$attrs">
    <AppIcon :name="icon" :size="18" color="var(--green-500)" />
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
