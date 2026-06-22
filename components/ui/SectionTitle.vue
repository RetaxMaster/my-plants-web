<script setup lang="ts">
defineOptions({ inheritAttrs: false });

const props = defineProps<{
  class?: unknown;
}>();
</script>

<template>
  <h2 :class="['mp-section-title', props.class]" v-bind="$attrs">
    <slot />
  </h2>
</template>

<style scoped>
.mp-section-title {
  font: 700 17px var(--font-sans);
  letter-spacing: -0.01em;
  color: var(--text-strong);
  margin: 0 0 12px;
}
</style>
