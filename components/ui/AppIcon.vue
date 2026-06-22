<script setup lang="ts">
const props = withDefaults(defineProps<{ name: string; size?: number; color?: string }>(), {
  size: 18,
  color: 'currentColor',
});

const iconify = computed(() => {
  const solid = props.name.startsWith('solid/');
  const base = solid ? props.name.slice(6) : props.name;
  return `heroicons:${base}${solid ? '-solid' : ''}`;
});
</script>

<template>
  <Icon :name="iconify" :style="{ fontSize: size + 'px', color }" />
</template>
