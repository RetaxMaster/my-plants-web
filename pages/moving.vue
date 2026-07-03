<script setup lang="ts">
import type { CitySearchResult, PlantViability } from '../types/api.js';
import { friendlyCityLabel } from '../utils/cityLabel.js';
import { speciesPrimaryName } from '../utils/displayName.js';

const { t } = useI18n();
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
      :eyebrow="$t('moving.eyebrow')"
      :title="$t('moving.title')"
      :subtitle="$t('moving.subtitle')"
    />

    <UiAlert
      v-if="scheduled"
      color="green"
      class="mp-moving__scheduled"
      icon="check-circle"
      :title="$t('moving.scheduledTitle')"
      :description="$t('moving.scheduledDesc')"
    />

    <div class="mp-form">
      <UiFormGroup :label="$t('moving.targetCity')" :hint="$t('moving.targetHint')">
        <CitySearch :placeholder="$t('moving.searchPlaceholder')" @select="onSelect" />
      </UiFormGroup>
      <div v-if="selection" class="mp-moving__sim">
        <i18n-t keypath="moving.simulatingAgainst" tag="span">
          <template #city><strong>{{ friendlyCityLabel(selection) }}</strong></template>
        </i18n-t>
      </div>
    </div>

    <div v-if="results" class="mp-moving__results">
      <UiSectionTitle>{{ $t('moving.howFare') }}</UiSectionTitle>

      <!-- No plant-fit results means there is nothing to schedule against. Show an
           empty state and keep the schedule controls hidden so a user can't book a
           move with zero results on screen. -->
      <UiCard v-if="!results.length" padded>
        <UiEmptyState>{{ $t('moving.noResults') }}</UiEmptyState>
      </UiCard>

      <template v-else>
        <UiCardGrid :desktop="isDesktop" :min="300" :gap="12">
          <UiCard v-for="r in results" :key="r.plantId" padded>
            <UiPlantName :title="r.nickname || speciesPrimaryName(r)" :scientific="r.speciesScientificName ?? undefined" />
            <div class="mp-moving__viability">
              <UiViabilityBadge :level="r.level" :reasons="r.reasons" />
            </div>
            <UiAlert
              v-if="!r.inPrimaryCity"
              color="amber"
              class="mp-moving__warning"
              :description="t('moving.notInCity', { city: r.placeCityName })"
            />
          </UiCard>
        </UiCardGrid>

        <div class="mp-moving__schedule">
          <UiFormGroup :label="$t('moving.moveOn')" class="mp-moving__date">
            <UiInput v-model="moveOn" type="date" />
          </UiFormGroup>
          <UiButton icon="truck" :disabled="!moveOn || !results.length || scheduling" :loading="scheduling" @click="schedule">
            {{ $t('moving.scheduleMove') }}
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

.mp-moving__warning {
  margin-top: 10px;
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
