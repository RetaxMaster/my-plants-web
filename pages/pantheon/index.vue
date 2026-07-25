<script setup lang="ts">
const { t } = useI18n();
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
      <UiPlantCard
        v-for="p in plants"
        :key="p.id"
        :plant="p"
        :to="`/pantheon/${p.id}`"
        variant="pantheon"
        :place-label="p.frozenPlaceLabel"
      />
    </UiCardGrid>
  </div>
</template>

<style scoped>
/* The card itself (banner/row/info) is the shared UiPlantCard component (variant="pantheon"). The
   memorial/serene `--pantheon` aesthetic lives in assets/css/chrome.css
   (`.mp-section--pantheon`/`.mp-card--pantheon`/`.mp-plantphoto--pantheon`) — a class-level, token-driven
   pass applied via the card's `variant` prop, no new markup. */
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
