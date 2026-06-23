<script setup lang="ts">
import type { CitySearchResult, PlantViability } from '../types/api.js';
import { friendlyCityLabel } from '../utils/cityLabel.js';
import { speciesPrimaryName } from '../utils/displayName.js';

const api = useApi();
const isDesktop = useIsDesktop();
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
  // Guard: never schedule without a city, a date, or with an empty simulation.
  if (!selection.value || !moveOn.value || !results.value?.length) return;
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
    <UiScreenHeader
      eyebrow="What-if"
      title="Moving"
      subtitle="Simulate a move and check each plant's fit."
    />

    <UiAlert
      v-if="scheduled"
      color="green"
      class="mp-moving__scheduled"
      icon="check-circle"
      title="Move scheduled"
      description="We'll recompute every plant's care for the new city on your move date."
    />

    <div class="mp-form">
      <UiFormGroup label="Target city" hint="See how your plants would fare before you commit.">
        <CitySearch placeholder="Search where you'd move them" @select="onSelect" />
      </UiFormGroup>
      <div v-if="selection" class="mp-moving__sim">
        Simulating against <strong>{{ friendlyCityLabel(selection) }}</strong>
      </div>
    </div>

    <div v-if="results" class="mp-moving__results">
      <UiSectionTitle>How your plants would fare</UiSectionTitle>

      <!-- No plant-fit results means there is nothing to schedule against. Show an
           empty state and keep the schedule controls hidden so a user can't book a
           move with zero results on screen. -->
      <UiCard v-if="!results.length" padded>
        <UiEmptyState>No plant-fit results to show for this city, so there's nothing to schedule yet.</UiEmptyState>
      </UiCard>

      <template v-else>
        <UiCardGrid :desktop="isDesktop" :min="300" :gap="12">
          <UiCard v-for="r in results" :key="r.plantId" padded>
            <UiPlantName :title="r.nickname || speciesPrimaryName(r)" :scientific="r.speciesScientificName ?? undefined" />
            <div class="mp-moving__viability">
              <UiViabilityBadge :level="r.level" :reasons="r.reasons" />
            </div>
          </UiCard>
        </UiCardGrid>

        <div class="mp-moving__schedule">
          <UiFormGroup label="Move on" class="mp-moving__date">
            <UiInput v-model="moveOn" type="date" />
          </UiFormGroup>
          <UiButton icon="truck" :disabled="!moveOn || !results.length || scheduling" :loading="scheduling" @click="schedule">
            Schedule move
          </UiButton>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.mp-moving__scheduled {
  margin-bottom: 18px;
}

.mp-moving__sim {
  font: 14px var(--font-sans);
  color: var(--text-body);
}

.mp-moving__sim strong {
  color: var(--text-strong);
}

.mp-moving__results {
  margin-top: 22px;
}

.mp-moving__viability {
  margin-top: 12px;
}

.mp-moving__schedule {
  margin-top: 20px;
  display: flex;
  gap: 12px;
  align-items: flex-end;
  flex-wrap: wrap;
}

.mp-moving__date {
  flex: 1 1 200px;
}
</style>
