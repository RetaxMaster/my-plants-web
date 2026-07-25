<script setup lang="ts">
const { t } = useI18n();
const api = useApi();
const isDesktop = useIsDesktop();

useHead(() => ({ title: t('meta.gifted.title') }));
useSeoMeta({ description: () => t('meta.gifted.description') });

// Frozen plants (Plant Lifecycle feature): plants the owner gave a new home. No care-engine data
// applies to a frozen plant, so this list carries no due-count badge — unlike the active `/plants`
// list it reuses the card shape from.
const { data: plants } = await useAsyncData('gifted-list', () => api.listGifted());
</script>

<template>
  <div class="mp-section mp-section--gifted">
    <UiScreenHeader :eyebrow="$t('gifted.eyebrow')" :title="$t('gifted.title')" :subtitle="$t('gifted.lede')" />

    <UiCard v-if="!plants?.length" padded>
      <UiEmptyState icon="gift" icon-color="var(--gifted-accent)">
        <div class="mp-section-empty__title">{{ $t('gifted.emptyTitle') }}</div>
        <p class="mp-section-empty__body">{{ $t('gifted.emptyBody') }}</p>
      </UiEmptyState>
    </UiCard>

    <UiCardGrid v-else :desktop="isDesktop" :min="300" :gap="12">
      <UiPlantCard
        v-for="p in plants"
        :key="p.id"
        :plant="p"
        :to="`/gifted/${p.id}`"
        variant="gifted"
        :place-label="p.frozenPlaceLabel"
      />
    </UiCardGrid>
  </div>
</template>

<style scoped>
/* The card itself (banner/row/info) is the shared UiPlantCard component (variant="gifted"). The
   warm/luminous `--gifted` aesthetic lives in assets/css/chrome.css
   (`.mp-section--gifted`/`.mp-card--gifted`/`.mp-plantphoto--gifted`) — a class-level, token-driven pass
   applied via the card's `variant` prop, no new markup. */
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
