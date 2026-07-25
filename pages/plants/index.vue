<script setup lang="ts">
const { t } = useI18n();
const api = useApi();
const isDesktop = useIsDesktop();

useHead(() => ({ title: t('meta.plants.title') }));
useSeoMeta({ description: () => t('meta.plants.description') });

const { data: plants } = await useAsyncData('plants-list', () => api.listPlants());
// Secondary: the due-count badge + place chip. Deferred to client so the list renders from ONE SSR read;
// the badge (`dueCountByPlant[p.id] ?? 0`) and `placeName` (v-if-guarded) already tolerate null.
const { data: tasks } = useLazyAsyncData('plants-list-today', () => api.todaysTasks(), { server: false });
const { data: places } = useLazyAsyncData('plants-list-places', () => api.listPlaces(), { server: false });

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
      <UiPlantCard
        v-for="p in plants"
        :key="p.id"
        :plant="p"
        :to="`/plants/${p.id}`"
        :place-label="placeName(p.placeId)"
        :due-count="dueCountByPlant[p.id] ?? 0"
      />
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
/* The gardener entry point sits below the garden, aligned to the trailing edge (where the owner marked
   it). Page-specific layout, so the spacing lives here rather than as a new design-system token. */
.mp-plants-gardener-cta {
  display: flex;
  justify-content: flex-end;
  margin-top: 16px;
}
</style>
