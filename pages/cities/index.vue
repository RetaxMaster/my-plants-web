<script setup lang="ts">
import type { CitySearchResult } from '../../types/api.js';
import { friendlyCityLabel } from '../../utils/cityLabel.js';

const { t } = useI18n();
const api = useApi();
const isDesktop = useIsDesktop();

useHead(() => ({ title: t('meta.cities.title') }));
useSeoMeta({ description: () => t('meta.cities.description') });

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
    <UiScreenHeader :title="$t('cities.title')" :subtitle="$t('cities.subtitle')" />

    <div :class="isDesktop ? 'mp-cities mp-cities--desktop' : 'mp-cities'">
      <div>
        <UiCard v-if="!cities?.length" padded>
          <UiEmptyState>{{ $t('cities.empty') }}</UiEmptyState>
        </UiCard>
        <UiCardGrid v-else :desktop="isDesktop" :min="260" :gap="12">
          <UiCard v-for="c in cities" :key="c.id" padded>
            <div class="mp-city-row">
              <UiIconTile icon="map-pin" :tone="c.isPrimary ? 'green' : 'cafe'" :size="40" />
              <div class="mp-city-row__info">
                <div class="mp-city-row__name-line">
                  <span class="mp-city-row__name">{{ c.name }}</span>
                  <UiBadge v-if="c.isPrimary" color="green" size="xs" dot>{{ $t('cities.primary') }}</UiBadge>
                </div>
                <div class="mp-city-row__meta">{{ c.timezone }}</div>
              </div>
              <UiButton v-if="!c.isPrimary" size="xs" variant="ghost" color="neutral" @click="makePrimary(c.id)">
                {{ $t('cities.makePrimary') }}
              </UiButton>
            </div>
          </UiCard>
        </UiCardGrid>
      </div>

      <div>
        <UiSectionTitle>{{ $t('cities.addTitle') }}</UiSectionTitle>
        <form class="mp-form" @submit.prevent="submit">
          <UiFormGroup :label="$t('cities.findCity')" required>
            <CitySearch :placeholder="$t('cities.cityPlaceholder')" @select="onSelect" />
          </UiFormGroup>
          <div v-if="selection" class="mp-city-preview">
            <i18n-t keypath="cities.willAdd" tag="span">
              <template #city><strong>{{ friendlyCityLabel(selection) }}</strong></template>
            </i18n-t>
            <span class="mp-city-preview__tz"> · {{ selection.timezone }}</span>
          </div>
          <UiFormGroup :label="$t('cities.primaryLabel')">
            <div class="mp-city-switch">
              <UiSwitch v-model="isPrimary" />
              <span class="mp-city-switch__text">{{ $t('cities.useAsHome') }}</span>
            </div>
          </UiFormGroup>
          <UiButton type="submit" block :disabled="!selection">{{ $t('cities.addCity') }}</UiButton>
        </form>
      </div>
    </div>
  </div>
</template>

<style scoped>
.mp-cities {
  display: grid;
  gap: 26px;
}

.mp-cities--desktop {
  grid-template-columns: 1fr 380px;
  gap: 28px;
  align-items: start;
}

.mp-city-row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.mp-city-row__info {
  flex: 1;
  min-width: 0;
}

.mp-city-row__name-line {
  display: flex;
  align-items: center;
  gap: 8px;
}

.mp-city-row__name {
  font: 700 15px var(--font-sans);
  color: var(--text-strong);
}

.mp-city-row__meta {
  font: 12px var(--font-sans);
  color: var(--text-muted);
}

.mp-city-preview {
  font: 14px var(--font-sans);
  color: var(--text-body);
}

.mp-city-preview strong {
  color: var(--text-strong);
}

.mp-city-preview__tz {
  color: var(--text-muted);
}

.mp-city-switch {
  display: flex;
  align-items: center;
  gap: 12px;
}

.mp-city-switch__text {
  font: 14px var(--font-sans);
  color: var(--text-muted);
}
</style>
