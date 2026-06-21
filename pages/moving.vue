<script setup lang="ts">
import type { CitySearchResult, PlantViability } from '../types/api.js';
import { friendlyCityLabel } from '../utils/cityLabel.js';
import { speciesPrimaryName } from '../utils/displayName.js';

const api = useApi();
const selection = ref<CitySearchResult | null>(null);
const results = ref<PlantViability[] | null>(null);
const moveOn = ref('');
const scheduling = ref(false);
const scheduled = ref(false);

async function onSelect(sel: CitySearchResult) {
  selection.value = sel;
  scheduled.value = false;
  results.value = await api.simulateMove(sel.latitude, sel.longitude);
}

async function schedule() {
  if (!selection.value || !moveOn.value) return;
  const sel = selection.value;
  scheduling.value = true;
  try {
    await api.scheduleMove(
      { name: friendlyCityLabel(sel), latitude: sel.latitude, longitude: sel.longitude, timezone: sel.timezone },
      moveOn.value,
    );
    // Clear the what-if state so the scheduled move can't be re-submitted by a second click.
    selection.value = null;
    results.value = null;
    moveOn.value = '';
    scheduled.value = true;
  } finally {
    scheduling.value = false;
  }
}
</script>

<template>
  <div>
    <h2 class="text-lg font-semibold mb-3">Moving — what-if</h2>
    <div class="grid gap-3 max-w-md mb-6">
      <UFormGroup label="Target city">
        <CitySearch placeholder="Search where you'd move them" @select="onSelect" />
      </UFormGroup>
      <p v-if="selection" class="text-sm">
        Simulating against <span class="font-medium">{{ friendlyCityLabel(selection) }}</span>
      </p>
    </div>

    <div v-if="results" class="grid gap-2 mb-6">
      <UCard v-for="r in results" :key="r.plantId">
        <div class="flex items-center justify-between">
          <div>
            <span class="font-medium">{{ r.nickname || speciesPrimaryName(r) }}</span>
            <span v-if="r.speciesScientificName && r.speciesScientificName !== (r.nickname || speciesPrimaryName(r))" class="text-xs text-gray-500 italic"> ({{ r.speciesScientificName }})</span>
          </div>
          <ViabilityBadge :level="r.level" :reasons="r.reasons" />
        </div>
      </UCard>
    </div>

    <div v-if="selection" class="flex gap-2 items-end max-w-md">
      <UFormGroup label="Move on" class="flex-1">
        <UInput v-model="moveOn" type="date" />
      </UFormGroup>
      <UButton :disabled="!moveOn || scheduling" @click="schedule">Schedule move</UButton>
    </div>
    <p v-if="scheduled" class="text-xs text-green-600 mt-2">Move scheduled.</p>
  </div>
</template>
