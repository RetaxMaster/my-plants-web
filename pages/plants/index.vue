<script setup lang="ts">
import { plantTitle } from '../../utils/displayName.js';

const { t } = useI18n();
const api = useApi();
const isDesktop = useIsDesktop();
const { data: plants } = await useAsyncData('plants-list', () => api.listPlants());
const { data: tasks } = await useAsyncData('plants-list-today', () => api.todaysTasks());
const { data: places } = await useAsyncData('plants-list-places', () => api.listPlaces());

// One todaysTasks() call → per-plant due-count map for the status badge.
const dueCountByPlant = computed(() => {
  const map: Record<string, number> = {};
  for (const t of tasks.value ?? []) map[t.plantId] = (map[t.plantId] ?? 0) + 1;
  return map;
});

const placeName = (id: string): string =>
  (places.value ?? []).find((pl) => pl.id === id)?.name ?? '';

const count = computed(() => plants.value?.length ?? 0);
const subtitle = computed(() => t('plants.countSub', { n: count.value }, count.value));
</script>

<template>
  <div>
    <UiScreenHeader :title="$t('plants.title')" :subtitle="subtitle">
      <template #action>
        <UiButton icon="plus" @click="navigateTo('/plants/new')">{{ $t('plants.add') }}</UiButton>
      </template>
    </UiScreenHeader>

    <UiCard v-if="!plants?.length" padded>
      <UiEmptyState>{{ $t('plants.empty') }}</UiEmptyState>
    </UiCard>

    <UiCardGrid v-else :desktop="isDesktop" :min="300" :gap="12">
      <UiCard
        v-for="p in plants"
        :key="p.id"
        :to="`/plants/${p.id}`"
        padded
      >
        <UiPlantPhoto
          :src="p.coverImageUrl"
          :alt="$t('plantPhoto.alt', { name: plantTitle(p) })"
          :height="118"
          class="mp-plant-row__banner"
        >
          <template v-if="placeName(p.placeId)" #chips>
            <UiPhotoChip icon="map-pin" :label="placeName(p.placeId)" />
          </template>
        </UiPlantPhoto>
        <div class="mp-plant-row">
          <UiPlantAvatar :size="48" />
          <div class="mp-plant-row__info">
            <UiPlantName :title="plantTitle(p)" :scientific="p.speciesScientificName" />
            <div v-if="placeName(p.placeId)" class="mp-plant-row__place">{{ placeName(p.placeId) }}</div>
          </div>
          <div class="mp-plant-row__end">
            <UiPlantStatusBadge :plant="p" :due-count="dueCountByPlant[p.id] ?? 0" />
            <UiAppIcon name="chevron-right" :size="18" color="var(--text-faint)" />
          </div>
        </div>
      </UiCard>
    </UiCardGrid>
  </div>
</template>

<style scoped>
.mp-plant-row__banner {
  margin-bottom: var(--space-3);
}

.mp-plant-row {
  display: flex;
  align-items: center;
  gap: 14px;
}

.mp-plant-row__info {
  flex: 1;
  min-width: 0;
}

.mp-plant-row__place {
  font: 13px var(--font-sans);
  color: var(--text-muted);
  margin-top: 2px;
}

.mp-plant-row__end {
  display: flex;
  align-items: center;
  gap: 8px;
}
</style>
