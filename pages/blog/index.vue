<script setup lang="ts">
const api = useApi();
const isDesktop = useIsDesktop();
const { data: species } = await useAsyncData('blog-species-list', () => api.listSpecies());
</script>

<template>
  <div>
    <UiScreenHeader
      :eyebrow="$t('blog.eyebrow')"
      :title="$t('blog.title')"
      :subtitle="$t('blog.subtitle')"
    />

    <UiCard v-if="!species?.length" padded>
      <UiEmptyState>{{ $t('blog.empty') }}</UiEmptyState>
    </UiCard>

    <UiCardGrid v-else :desktop="isDesktop" :min="300" :gap="14">
      <UiCard
        v-for="s in species"
        :key="s.slug"
        :to="`/blog/${s.slug}`"
        padded
      >
        <div class="mp-blog-row">
          <UiIconTile icon="book-open" tone="green" :size="48" />
          <div class="mp-blog-row__info">
            <div class="mp-blog-row__common">{{ s.commonName || s.scientificName }}</div>
            <div
              v-if="s.scientificName && s.scientificName !== (s.commonName || s.scientificName)"
              class="mp-blog-row__sci"
            >{{ s.scientificName }}</div>
          </div>
          <UiAppIcon name="chevron-right" :size="18" color="var(--text-faint)" />
        </div>
      </UiCard>
    </UiCardGrid>
  </div>
</template>

<style scoped>
.mp-blog-row {
  display: flex;
  align-items: center;
  gap: 14px;
}

.mp-blog-row__info {
  flex: 1;
  min-width: 0;
}

.mp-blog-row__common {
  font: 700 15px var(--font-sans);
  color: var(--text-strong);
}

.mp-blog-row__sci {
  font: italic 13px var(--font-sans);
  color: var(--text-muted);
}
</style>
