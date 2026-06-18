<script setup lang="ts">
const links = [
  { label: 'Today', to: '/', icon: 'i-heroicons-sun' },
  { label: 'Plants', to: '/plants', icon: 'i-heroicons-sparkles' },
  { label: 'Places', to: '/places', icon: 'i-heroicons-home' },
  { label: 'Cities', to: '/cities', icon: 'i-heroicons-map-pin' },
  { label: 'Moving', to: '/moving', icon: 'i-heroicons-truck' },
];
</script>

<template>
  <nav class="flex gap-1 border-b border-gray-200 px-4 py-2">
    <UButton v-for="l in links" :key="l.to" :to="l.to" :icon="l.icon" variant="ghost" color="gray">{{ l.label }}</UButton>
  </nav>
</template>
