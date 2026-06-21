<script setup lang="ts">
import type { CitySearchResult } from '../../types/api.js';
import { friendlyCityLabel } from '../../utils/cityLabel.js';

const api = useApi();
const { data: cities, refresh } = await useAsyncData('cities', () => api.listCities());

const selection = ref<CitySearchResult | null>(null);
const isPrimary = ref(false);

function onSelect(sel: CitySearchResult) {
  selection.value = sel;
}

async function submit() {
  if (!selection.value) return;
  const sel = selection.value;
  await api.createCity({
    name: friendlyCityLabel(sel),
    latitude: sel.latitude,
    longitude: sel.longitude,
    timezone: sel.timezone,
    isPrimary: isPrimary.value,
  });
  selection.value = null;
  isPrimary.value = false;
  await refresh();
}

async function makePrimary(id: string) {
  await api.makePrimaryCity(id);
  await refresh();
}
</script>

<template>
  <div>
    <h2 class="text-lg font-semibold mb-3">Cities</h2>
    <div class="grid gap-2 mb-6">
      <UCard v-for="c in cities" :key="c.id">
        <div class="flex items-center justify-between">
          <span class="font-medium">{{ c.name }} <UBadge v-if="c.isPrimary" color="green" size="xs">Primary</UBadge></span>
          <UButton v-if="!c.isPrimary" size="xs" variant="ghost" @click="makePrimary(c.id)">Make primary</UButton>
        </div>
        <span class="text-xs text-gray-500">{{ c.timezone }}</span>
      </UCard>
    </div>

    <div class="grid gap-3 max-w-md">
      <UFormGroup label="Find a city" required>
        <CitySearch placeholder="e.g. Guadalajara" @select="onSelect" />
      </UFormGroup>
      <p v-if="selection" class="text-sm">
        Will add: <span class="font-medium">{{ friendlyCityLabel(selection) }}</span>
        <span class="text-xs text-gray-500"> · {{ selection.timezone }}</span>
      </p>
      <UFormGroup label="Primary"><UToggle v-model="isPrimary" /></UFormGroup>
      <UButton :disabled="!selection" @click="submit">Add city</UButton>
    </div>
  </div>
</template>
