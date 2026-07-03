<script setup lang="ts">
import { pickLocalized } from '../../utils/localizedField.js';
import { renderMarkdown } from '../../utils/renderMarkdown.js';
import { youtubeEmbedUrl } from '../../utils/youtube.js';
import { formatBlogDate } from '../../utils/blogDate.js';

const route = useRoute();
const api = useApi();
const { locale } = useI18n();
const slug = route.params.id as string;

// getBlogpost 404s for a missing/unpublished slug -> useAsyncData surfaces `error`; we render a
// friendly not-found state instead of bubbling a 500.
const { data: post, error } = await useAsyncData(`blog-${slug}`, () => api.getBlogpost(slug));

const title = computed(() =>
  post.value ? pickLocalized(locale.value, post.value.titleEs, post.value.titleEn) ?? post.value.titleEs : '',
);
const excerpt = computed(() =>
  post.value ? pickLocalized(locale.value, post.value.excerptEs, post.value.excerptEn) : null,
);
const body = computed(() =>
  post.value ? pickLocalized(locale.value, post.value.bodyEs, post.value.bodyEn) : null,
);
// Same marked -> sanitize pipeline as the editor preview (shared helper), so preview == published.
const articleHtml = computed(() => (body.value ? renderMarkdown(body.value) : ''));
const embedUrl = computed(() => youtubeEmbedUrl(post.value?.youtubeUrl));
const ctaLabel = computed(() =>
  post.value ? pickLocalized(locale.value, post.value.ctaLabelEs, post.value.ctaLabelEn) : null,
);
const dateLabel = computed(() => (post.value ? formatBlogDate(locale.value, post.value.publishedAt) : ''));
</script>

<template>
  <div v-if="post">
    <button type="button" class="mp-backlink" @click="navigateTo('/blog')">
      <UiAppIcon name="chevron-left" :size="16" color="currentColor" />
      {{ $t('blog.allArticles') }}
    </button>

    <article class="mp-article">
      <div class="mp-article__badges">
        <UiBadge color="green" size="sm" dot>{{ $t('blog.careGuide') }}</UiBadge>
        <UiBadge v-if="post.difficulty" color="cafe" size="sm">{{ post.difficulty }}</UiBadge>
      </div>

      <h1 class="mp-article__title">
        {{ title }}
        <span v-if="post.speciesScientificName" class="mp-article__sci">({{ post.speciesScientificName }})</span>
      </h1>
      <div class="mp-article__meta">{{ dateLabel }} · {{ $t('blog.minRead', { min: post.readingMinutes }) }}</div>

      <img v-if="post.coverImageUrl" :src="post.coverImageUrl" :alt="title" class="mp-article__cover" />

      <p v-if="!body" class="mp-article__empty">{{ $t('blog.noArticle') }}</p>
      <UiProse v-else :html="articleHtml" />

      <div v-if="embedUrl" class="mp-article__video">
        <iframe
          :src="embedUrl"
          :title="$t('blog.watchVideo')"
          loading="lazy"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowfullscreen
        />
      </div>

      <div v-if="post.ctaLink && ctaLabel" class="mp-article__cta">
        <a :href="post.ctaLink" target="_blank" rel="noopener noreferrer" class="mp-article__ctabtn">
          {{ ctaLabel }}
          <UiAppIcon name="arrow-right" :size="16" color="currentColor" />
        </a>
      </div>
    </article>
  </div>

  <div v-else class="mp-notfound">
    <UiEmptyState icon="magnifying-glass">
      <div class="mp-notfound__title">{{ $t('blog.notFound') }}</div>
      <p class="mp-notfound__lead">{{ error ? $t('blog.notFoundLead') : $t('common.loading') }}</p>
      <button type="button" class="mp-backlink mp-notfound__back" @click="navigateTo('/blog')">
        <UiAppIcon name="chevron-left" :size="16" color="currentColor" /> {{ $t('blog.backToBlog') }}
      </button>
    </UiEmptyState>
  </div>
</template>

<style scoped>
.mp-article { max-width: 680px; margin: 0 auto; }
@media (min-width: 880px) { .mp-article { max-width: 900px; } }
.mp-article__badges { margin-bottom: 18px; display: flex; align-items: center; gap: 10px; }
.mp-article__title { font: 800 clamp(22px, 3.5vw, 28px) var(--font-sans); letter-spacing: -0.02em; color: var(--text-strong); margin: 0 0 8px; }
.mp-article__sci { font: italic var(--weight-regular) 18px var(--font-sans); color: var(--text-muted); }
.mp-article__meta { font: 600 12px var(--font-sans); color: var(--text-faint); margin-bottom: 18px; }
.mp-article__cover { width: 100%; border-radius: 14px; margin-bottom: 22px; box-shadow: var(--shadow-md); }
.mp-article__empty { color: var(--text-muted); margin-top: 16px; }
.mp-article__video { position: relative; aspect-ratio: 16 / 9; margin-top: 26px; border-radius: 14px; overflow: hidden; }
.mp-article__video iframe { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; }
.mp-article__cta { margin-top: 26px; }
.mp-article__ctabtn {
  display: inline-flex; align-items: center; gap: 8px;
  padding: 10px 18px; border-radius: var(--radius-md);
  background: var(--brand-primary); color: #fff;
  font: 600 14px var(--font-sans); text-decoration: none;
}
.mp-notfound { max-width: 520px; margin: 40px auto; }
.mp-notfound__title { font: 700 16px var(--font-sans); color: var(--text-strong); }
.mp-notfound__lead { margin: 6px 0 12px; font: 14px var(--font-sans); color: var(--text-muted); }
.mp-notfound__back { margin-bottom: 0; }
</style>
