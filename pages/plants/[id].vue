<script setup lang="ts">
const route = useRoute();
const api = useApi();
const id = route.params.id as string;
const { data: plant } = await useAsyncData(`plant-${id}`, () => api.getPlant(id));
</script>

<template>
  <div v-if="plant">
    <NuxtLink to="/plants" class="text-sm text-gray-500 hover:underline">← All plants</NuxtLink>
    <h2 class="text-xl font-bold mt-2">{{ plant.nickname ?? plant.speciesSlug }}</h2>
    <p class="text-gray-500">{{ plant.speciesSlug }}</p>
    <p class="text-sm text-gray-500 mt-1">Acquired {{ plant.acquiredOn.slice(0, 10) }}</p>
  </div>
  <p v-else class="text-gray-500">Loading…</p>
</template>
