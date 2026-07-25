<script setup lang="ts">
import { plantTitle } from '../../utils/displayName.js';

const { t, locale } = useI18n();
const api = useApi();
const isDesktop = useIsDesktop();

useHead(() => ({ title: t('meta.plants.title') }));
useSeoMeta({ description: () => t('meta.plants.description') });

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
        :padded="false"
      >
        <UiPlantPhoto
          :src="p.coverImageUrl"
          :alt="$t('plantPhoto.alt', { name: plantTitle(p, locale) })"
          :height="118"
          class="mp-plant-card__banner"
        >
          <template v-if="placeName(p.placeId)" #chips>
            <UiPhotoChip icon="map-pin" :label="placeName(p.placeId)" />
          </template>
        </UiPlantPhoto>
        <div class="mp-plant-card__row">
          <div class="mp-plant-card__info">
            <UiPlantName :title="plantTitle(p, locale)" :scientific="p.speciesScientificName" />
          </div>
          <UiPlantStatusBadge :plant="p" :due-count="dueCountByPlant[p.id] ?? 0" />
          <UiAppIcon name="chevron-right" :size="18" color="var(--text-faint)" />
        </div>
      </UiCard>
    </UiCardGrid>

    <!-- The gardener entry point. Owner's ruling (Spec 4 §7, placement updated 2026-07-24): still ONE
         garden-wide action, never one per plant card — a per-card button would read as "the gardener OF
         THIS PLANT", the Doctor's role, which the two-agent design exists to keep apart. The owner moved
         it from the page header to below the garden; it stays a single garden-wide surface and is shown
         whether or not there are plants. `icon="heart"` matches the doctor's entry point — the same
         "talk to an agent" affordance. -->
    <div class="mp-plants-gardener-cta">
      <UiButton variant="soft" color="cafe" icon="heart" to="/gardener" data-testid="gardener-entry">
        {{ $t('plants.gardener') }}
      </UiButton>
    </div>
  </div>
</template>

<style scoped>
/* Banner sits flush at the card's top edge (the card clips it to its rounded corners); square its
   own corners so only the card radius shows. */
.mp-plant-card__banner {
  border-radius: 0;
}

.mp-plant-card__row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
}

.mp-plant-card__info {
  flex: 1;
  min-width: 0;
}

/* The gardener entry point sits below the garden, aligned to the trailing edge (where the owner marked
   it). Page-specific layout, so the spacing lives here rather than as a new design-system token. */
.mp-plants-gardener-cta {
  display: flex;
  justify-content: flex-end;
  margin-top: 16px;
}
</style>
