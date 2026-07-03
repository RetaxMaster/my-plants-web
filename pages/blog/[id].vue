<script setup lang="ts">
import { marked } from 'marked';

const route = useRoute();
const api = useApi();
const slug = route.params.id as string;
const { data: brief } = await useAsyncData(`blog-${slug}`, () => api.getSpeciesBrief(slug));

// The brief is our own curated Markdown (authored by the editorial-writer, persisted only via the
// knowledge-engine's db:insert — trusted content, never user-supplied), so rendering it to HTML for
// a polished, readable article is safe here.
const articleHtml = computed(() =>
  brief.value?.briefEs ? (marked.parse(brief.value.briefEs, { async: false }) as string) : '',
);
</script>

<template>
  <div v-if="brief">
    <button type="button" class="mp-backlink" @click="navigateTo('/blog')">
      <UiAppIcon name="chevron-left" :size="16" color="currentColor" />
      {{ $t('blog.allArticles') }}
    </button>

    <article class="mp-article">
      <div class="mp-article__badges">
        <UiBadge color="green" size="sm" dot>{{ $t('blog.careGuide') }}</UiBadge>
      </div>
      <h1 class="mp-article__title">
        {{ brief.commonNames[0] ?? brief.scientificName }}
        <span v-if="brief.commonNames.length" class="mp-article__sci">({{ brief.scientificName }})</span>
      </h1>

      <p v-if="!brief.briefEs" class="mp-article__empty">No article available yet.</p>
      <UiProse v-else :html="articleHtml" />
    </article>
  </div>
  <UiEmptyState v-else>{{ $t('common.loading') }}</UiEmptyState>
</template>

<style scoped>
.mp-article {
  max-width: 680px;
  margin: 0 auto;
}

/* Reading measure on desktop; mobile keeps the base width. */
@media (min-width: 880px) {
  .mp-article {
    max-width: 900px;
  }
}

.mp-article__badges {
  margin-bottom: 18px;
  display: flex;
  align-items: center;
  gap: 10px;
}

.mp-article__title {
  font: 800 clamp(22px, 3.5vw, 28px) var(--font-sans);
  letter-spacing: -0.02em;
  color: var(--text-strong);
  margin: 0 0 18px;
}

.mp-article__sci {
  font: italic var(--weight-normal) 18px var(--font-sans);
  color: var(--text-muted);
}

.mp-article__empty {
  color: var(--text-muted);
  margin-top: 16px;
}
</style>
