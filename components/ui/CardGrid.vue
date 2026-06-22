<script setup lang="ts">
defineOptions({ inheritAttrs: false });

const props = withDefaults(
  defineProps<{
    min?: number;
    gap?: number;
    desktop?: boolean;
    class?: unknown;
  }>(),
  {
    min: 280,
    gap: 14,
    desktop: false,
  },
);

const gridTemplateColumns = computed(() =>
  props.desktop ? `repeat(auto-fill, minmax(${props.min}px, 1fr))` : '1fr',
);
</script>

<template>
  <div
    :class="['mp-card-grid', props.class]"
    :style="{ gap: gap + 'px', gridTemplateColumns }"
    v-bind="$attrs"
  >
    <slot />
  </div>
</template>

<style scoped>
.mp-card-grid {
  display: grid;
}
</style>
