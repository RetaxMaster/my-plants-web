<script setup lang="ts">
defineOptions({ inheritAttrs: false });

const props = withDefaults(
  defineProps<{
    title: string;
    scientific?: string;
    size?: number;
    class?: unknown;
  }>(),
  {
    size: 15,
  },
);

const showScientific = computed(
  () => !!props.scientific && props.scientific !== props.title,
);
</script>

<template>
  <span :class="['mp-plant-name', props.class]" v-bind="$attrs">
    <span class="mp-plant-name__title" :style="{ font: `700 ${size}px var(--font-sans)` }">{{ title }}</span>
    <span
      v-if="showScientific"
      class="mp-plant-name__sci"
      :style="{ font: `italic ${size - 2}px var(--font-sans)` }"
    >({{ scientific }})</span>
  </span>
</template>

<style scoped>
.mp-plant-name {
  display: inline-flex;
  align-items: baseline;
  gap: 6px;
  flex-wrap: wrap;
}

.mp-plant-name__title {
  color: var(--text-strong);
}

.mp-plant-name__sci {
  color: var(--text-muted);
}
</style>
