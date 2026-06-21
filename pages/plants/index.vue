<script setup lang="ts">
import { plantTitle } from '../../utils/displayName.js';
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
        <div>
          <NuxtLink :to="`/plants/${p.id}`" class="font-medium hover:underline">{{ plantTitle(p) }}</NuxtLink>
          <span v-if="p.speciesScientificName && p.speciesScientificName !== plantTitle(p)" class="text-xs text-gray-500 italic"> ({{ p.speciesScientificName }})</span>
        </div>
      </UCard>
    </div>
  </div>
</template>
