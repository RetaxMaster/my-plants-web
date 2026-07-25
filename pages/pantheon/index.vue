<script setup lang="ts">
import { plantTitle } from '../../utils/displayName.js';

const { t, locale } = useI18n();
const api = useApi();
const isDesktop = useIsDesktop();

useHead(() => ({ title: t('meta.pantheon.title') }));
useSeoMeta({ description: () => t('meta.pantheon.description') });

// Frozen plants (Plant Lifecycle feature): the pantheon is a memorial for plants that have passed on.
// No care-engine data applies to a frozen plant, so this list carries no due-count badge — unlike the
// active `/plants` list it reuses the card shape from.
const { data: plants } = await useAsyncData('pantheon-list', () => api.listPantheon());
</script>

<template>
  <div class="mp-section mp-section--pantheon">
    <UiScreenHeader :eyebrow="$t('pantheon.eyebrow')" :title="$t('pantheon.title')" :subtitle="$t('pantheon.lede')" />

    <UiCard v-if="!plants?.length" padded>
      <UiEmptyState icon="archive-box" icon-color="var(--pantheon-accent)">
        <div class="mp-section-empty__title">{{ $t('pantheon.emptyTitle') }}</div>
        <p class="mp-section-empty__body">{{ $t('pantheon.emptyBody') }}</p>
      </UiEmptyState>
    </UiCard>

    <UiCardGrid v-else :desktop="isDesktop" :min="300" :gap="12">
      <UiCard
        v-for="p in plants"
        :key="p.id"
        :to="`/pantheon/${p.id}`"
        :padded="false"
        class="mp-card--pantheon"
      >
        <UiPlantPhoto
          :src="p.coverImageUrl"
          :alt="$t('plantPhoto.alt', { name: plantTitle(p, locale) })"
          :height="118"
          class="mp-plant-card__banner mp-plantphoto--pantheon"
        >
          <template v-if="p.frozenPlaceLabel" #chips>
            <UiPhotoChip icon="map-pin" :label="p.frozenPlaceLabel" />
          </template>
        </UiPlantPhoto>
        <div class="mp-plant-card__row">
          <div class="mp-plant-card__info">
            <UiPlantName :title="plantTitle(p, locale)" :scientific="p.speciesScientificName" />
          </div>
          <UiAppIcon name="chevron-right" :size="18" color="var(--text-faint)" />
        </div>
      </UiCard>
    </UiCardGrid>
  </div>
</template>

<style scoped>
/* Same card composition as /plants (banner flush to the card's top edge; own corners squared so only
   the card radius shows). The memorial/serene `--pantheon` aesthetic itself lives in
   assets/css/chrome.css (`.mp-section--pantheon`/`.mp-card--pantheon`/`.mp-plantphoto--pantheon`) —
   a class-level, token-driven pass, no new markup. */
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

.mp-section-empty__title {
  font: 700 16px var(--font-sans);
  color: var(--text-strong);
}

.mp-section-empty__body {
  margin: 6px 0 0;
  font: 14px var(--font-sans);
  color: var(--text-muted);
}
</style>
