<script setup lang="ts">
import type { PlantViability } from '../types/api.js';

const api = useApi();
const { data: cities } = await useAsyncData('cities', () => api.listCities());
const targetCityId = ref('');
const results = ref<PlantViability[] | null>(null);
const cityOptions = computed(() => (cities.value ?? []).map((c) => ({ label: c.name, value: c.id })));

async function simulate() {
  results.value = await api.simulateMove(targetCityId.value);
}
</script>

<template>
  <div>
    <h2 class="text-lg font-semibold mb-3">Moving — what-if</h2>
    <div class="flex gap-2 items-end max-w-md mb-6">
      <UFormGroup label="Target city" class="flex-1">
        <USelect v-model="targetCityId" :options="cityOptions" placeholder="Pick a city" />
      </UFormGroup>
      <UButton :disabled="!targetCityId" @click="simulate">Simulate</UButton>
    </div>
    <div v-if="results" class="grid gap-2">
      <UCard v-for="r in results" :key="r.plantId">
        <div class="flex items-center justify-between">
          <span class="font-medium">{{ r.nickname ?? r.speciesSlug }}</span>
          <ViabilityBadge :level="r.level" :reasons="r.reasons" />
        </div>
      </UCard>
    </div>
  </div>
</template>
