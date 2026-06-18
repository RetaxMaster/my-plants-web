<script setup lang="ts">
const api = useApi();
const { data: plants } = await useAsyncData('plants-list', () => api.listPlants());
</script>

<template>
  <div>
    <div class="flex items-center justify-between mb-3">
      <h2 class="text-lg font-semibold">Your plants</h2>
      <UButton to="/plants/new" icon="i-heroicons-plus">Add plant</UButton>
    </div>
    <p v-if="!plants?.length" class="text-gray-500">No plants yet.</p>
    <div class="grid gap-2">
      <UCard v-for="p in plants" :key="p.id">
        <NuxtLink :to="`/plants/${p.id}`" class="font-medium hover:underline">
          {{ p.nickname ?? p.speciesSlug }}
        </NuxtLink>
        <p class="text-xs text-gray-500">{{ p.speciesSlug }}</p>
      </UCard>
    </div>
  </div>
</template>
