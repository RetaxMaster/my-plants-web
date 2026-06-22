<script setup lang="ts">
import AppIcon from './AppIcon.vue';

defineOptions({ inheritAttrs: false });

const props = withDefaults(
  defineProps<{
    size?: number;
    icon?: string;
    class?: unknown;
  }>(),
  {
    size: 44,
    icon: 'sparkles',
  },
);

const iconSize = computed(() => Math.round(props.size * 0.5));
</script>

<template>
  <div
    :class="['mp-avatar', props.class]"
    :style="{ width: size + 'px', height: size + 'px' }"
    v-bind="$attrs"
  >
    <AppIcon :name="icon" :size="iconSize" color="var(--accent-green-ink)" />
  </div>
</template>

<style scoped>
.mp-avatar {
  flex: none;
  border-radius: 50%;
  overflow: hidden;
  background: var(--accent-green-surface);
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: inset 0 0 0 1px color-mix(in oklch, var(--accent-green-ink) 25%, transparent);
}
</style>
