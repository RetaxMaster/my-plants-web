<script setup lang="ts">
import type { BlogpostDetail, BlogpostAdminDetail } from '../../types/api.js';
import { pickLocalized } from '../../utils/localizedField.js';
import { renderArticle } from '../../utils/renderArticle.js';
import { youtubeEmbedUrl } from '../../utils/youtube.js';
import { formatBlogDate } from '../../utils/blogDate.js';
import { safeHttpUrl } from '../../utils/safeUrl.js';
import { readingMinutes } from '../../utils/readingTime.js';
import { absoluteUrl } from '../../utils/absoluteUrl.js';
import { BLOG_AUTHOR } from '../../utils/author.js';

const route = useRoute();
const api = useApi();
const { locale } = useI18n();
const { user } = useUserSession();
const requestUrl = useRequestURL();
const slug = route.params.id as string;
const author = BLOG_AUTHOR;

const isAdmin = computed(() => user.value?.role === 'ADMIN');

// One normalized shape the template renders, regardless of which endpoint fed it. The public detail
// carries derived fields (readingMinutes/difficulty/species); the raw admin row does not — so for a
// draft we compute reading time from the body and omit difficulty/species (showing them would need an
// API change, out of scope). Defined LOCALLY (not in types/api.ts) so it never conflicts with Spec B.
interface ArticleView {
  titleEs: string; titleEn: string | null;
  excerptEs: string; excerptEn: string | null;
  bodyEs: string; bodyEn: string | null;
  coverImageUrl: string | null;
  youtubeUrl: string | null;
  ctaLink: string | null; ctaLabelEs: string | null; ctaLabelEn: string | null;
  dateIso: string | null;
  readingMinutes: number;
  difficulty: string | null;
  speciesScientificName: string | null;
}

function fromPublic(p: BlogpostDetail): ArticleView {
  return {
    titleEs: p.titleEs, titleEn: p.titleEn,
    excerptEs: p.excerptEs, excerptEn: p.excerptEn,
    bodyEs: p.bodyEs, bodyEn: p.bodyEn,
    coverImageUrl: p.coverImageUrl,
    youtubeUrl: p.youtubeUrl,
    ctaLink: p.ctaLink, ctaLabelEs: p.ctaLabelEs, ctaLabelEn: p.ctaLabelEn,
    dateIso: p.publishedAt,
    readingMinutes: p.readingMinutes,
    difficulty: p.difficulty,
    speciesScientificName: p.speciesScientificName,
  };
}

function fromAdmin(p: BlogpostAdminDetail): ArticleView {
  return {
    titleEs: p.titleEs, titleEn: p.titleEn,
    excerptEs: p.excerptEs, excerptEn: p.excerptEn,
    bodyEs: p.bodyEs, bodyEn: p.bodyEn,
    coverImageUrl: p.coverImageUrl,
    youtubeUrl: p.youtubeUrl,
    ctaLink: p.ctaLink, ctaLabelEs: p.ctaLabelEs, ctaLabelEn: p.ctaLabelEn,
    // A draft has no publishedAt — fall back to updatedAt just so the meta line has a date.
    dateIso: p.publishedAt ?? p.updatedAt,
    // No readingMinutes on the raw row — compute from the ES body (shared util, no fork).
    readingMinutes: readingMinutes(p.bodyEs),
    difficulty: null,               // not on the admin row
    speciesScientificName: null,    // not on the admin row
  };
}

// getBlogpost 404s for a missing/unpublished slug. For an ADMIN we retry the RolesGuard admin endpoint
// so a DRAFT renders as a preview; for anyone else the 404 stands (drafts stay protected — the API
// also rejects a forged non-admin call server-side). Fallback lives INSIDE the handler so SSR (admin
// cookie forwarded) and client behave identically.
const { data, error } = await useAsyncData(`blog-article-${slug}`, async () => {
  try {
    const post = await api.getBlogpost(slug);
    return { view: fromPublic(post), isDraft: false };
  } catch (e: any) {
    const status = e?.statusCode ?? e?.response?.status;
    if (status === 404 && isAdmin.value) {
      const draft = await api.getBlogpostAdmin(slug);
      return { view: fromAdmin(draft), isDraft: true };
    }
    throw e;
  }
});

const view = computed<ArticleView | null>(() => data.value?.view ?? null);
const isDraft = computed(() => data.value?.isDraft ?? false);

// Not-found (missing slug, or a draft an anonymous visitor can't see) still renders the friendly
// not-found UI, but the SSR response must carry a real 404 — otherwise crawlers treat the not-found
// page as a live 200 (soft-404). Set it on the server when there is no article to show.
if (import.meta.server && !data.value) {
  const event = useRequestEvent();
  if (event) setResponseStatus(event, 404);
}

const title = computed(() =>
  view.value ? pickLocalized(locale.value, view.value.titleEs, view.value.titleEn) ?? view.value.titleEs : '',
);
const excerpt = computed(() =>
  view.value ? pickLocalized(locale.value, view.value.excerptEs, view.value.excerptEn) : null,
);
const body = computed(() =>
  view.value ? pickLocalized(locale.value, view.value.bodyEs, view.value.bodyEn) : null,
);
// NEW public renderer: adds h2/h3 ids + extracts the TOC (the editor preview keeps renderMarkdown).
const rendered = computed(() => (body.value ? renderArticle(body.value) : { html: '', toc: [] }));
const articleHtml = computed(() => rendered.value.html);
const toc = computed(() => rendered.value.toc);

const embedUrl = computed(() => youtubeEmbedUrl(view.value?.youtubeUrl));
const ctaLabel = computed(() =>
  view.value ? pickLocalized(locale.value, view.value.ctaLabelEs, view.value.ctaLabelEn) : null,
);
// Author-supplied link — guard the scheme so a stored `javascript:` CTA can never become an XSS vector.
const ctaHref = computed(() => safeHttpUrl(view.value?.ctaLink));
const dateLabel = computed(() => (view.value ? formatBlogDate(locale.value, view.value.dateIso) : ''));
const readingMin = computed(() => view.value?.readingMinutes ?? 1);

// --- SEO (§4.7): reactive getters so a locale switch updates the tags. Cover is the Meta OG image,
// resolved to an ABSOLUTE URL; omitted entirely when there is no cover (no broken og:image). Canonical
// is the article URL at the request origin.
const absoluteCover = computed(() => absoluteUrl(view.value?.coverImageUrl ?? null, requestUrl.origin));
const canonicalUrl = computed(() => `${requestUrl.origin}/blog/${slug}`);

useSeoMeta({
  title: () => title.value,
  description: () => excerpt.value ?? '',
  ogTitle: () => title.value,
  ogDescription: () => excerpt.value ?? '',
  ogType: 'article',
  ogImage: () => absoluteCover.value ?? undefined,
  twitterCard: 'summary_large_image',
  twitterImage: () => absoluteCover.value ?? undefined,
});
useHead(() => ({ link: [{ rel: 'canonical', href: canonicalUrl.value }] }));
</script>

<template>
  <div v-if="view">
    <!-- Reading progress: fixed at the very top edge, tracks the whole article element. -->
    <UiReadingProgress target=".mp-article" />

    <button type="button" class="mp-backlink" @click="navigateTo('/blog')">
      <UiAppIcon name="chevron-left" :size="16" color="currentColor" />
      {{ $t('blog.allArticles') }}
    </button>

    <div v-if="isDraft" class="mp-preview-banner">
      <UiAppIcon name="eye" :size="15" color="currentColor" />
      {{ $t('blog.preview.draftBanner') }}
    </div>

    <article class="mp-article">
      <!-- HERO (§4.5): cover fills a large band with a legibility scrim; text stacks on top.
           Degrades to a solid surface band when there is no cover. The cover is the LCP → eager. -->
      <header class="mp-hero" :class="{ 'mp-hero--nocover': !view.coverImageUrl }">
        <img
          v-if="view.coverImageUrl"
          :src="view.coverImageUrl"
          :alt="title"
          class="mp-hero__img"
          fetchpriority="high"
          decoding="async"
        />
        <div v-if="view.coverImageUrl" class="mp-hero__scrim" aria-hidden="true" />
        <div class="mp-hero__content">
          <div class="mp-hero__badges">
            <UiBadge color="green" size="sm" dot>{{ $t('blog.careGuide') }}</UiBadge>
            <UiBadge v-if="view.difficulty" color="cafe" size="sm">{{ view.difficulty }}</UiBadge>
          </div>
          <h1 class="mp-hero__title">
            {{ title }}
            <span v-if="view.speciesScientificName" class="mp-hero__sci">({{ view.speciesScientificName }})</span>
          </h1>
          <p v-if="excerpt" class="mp-hero__excerpt">{{ excerpt }}</p>
          <div class="mp-hero__meta">{{ dateLabel }} · {{ $t('blog.minRead', { min: readingMin }) }}</div>
          <UiAuthorByline :name="author.name" :avatar="author.avatar" :size="40" class="mp-hero__byline">
            <template #role>{{ $t('blog.author.role') }}</template>
          </UiAuthorByline>
        </div>
      </header>

      <!-- BODY: sticky TOC rail beside the article column on wide screens; TOC sits above the body on
           narrow screens (no cover-flow / no CLS — the list is server-rendered). -->
      <div class="mp-article__layout" :class="{ 'mp-article__layout--withtoc': toc.length }">
        <aside v-if="toc.length" class="mp-article__rail">
          <UiArticleToc :items="toc" :title="$t('blog.toc')" class="mp-article__toc" />
        </aside>

        <div class="mp-article-body">
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

          <!-- Prominent final CTA (§4.6): a bordered panel with a short lead + a large action.
               The action stays an <a> (external link, target/_blank + rel) styled with brand tokens —
               a <button> nested in an <a> would be invalid markup — inside a UiCard panel. -->
          <UiCard v-if="ctaHref && ctaLabel" class="mp-cta" padded>
            <div class="mp-cta__lead">{{ $t('blog.cta.lead') }}</div>
            <a :href="ctaHref" target="_blank" rel="noopener noreferrer" class="mp-cta__btn">
              {{ ctaLabel }}
              <UiAppIcon name="arrow-right" :size="18" color="currentColor" />
            </a>
          </UiCard>
        </div>
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
/* Draft preview banner (admin-only) */
.mp-preview-banner {
  display: inline-flex; align-items: center; gap: 7px;
  padding: 7px 12px; margin-bottom: 16px; border-radius: var(--radius-pill);
  background: var(--brand-accent-subtle); color: var(--accent-cafe-ink);
  font: 700 12px var(--font-sans);
}

/* HERO */
.mp-hero {
  position: relative; overflow: hidden; border-radius: var(--radius-lg);
  min-height: 340px; margin-bottom: 30px;
  display: flex; align-items: flex-end;
  background: var(--surface-sunken);
}
@media (min-width: 880px) { .mp-hero { min-height: 420px; } }
.mp-hero__img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; display: block; }
/* Legibility scrim — a translucent dark gradient (rgba, not a brand color) so white text reads on any
   cover. NOT a blur (perf invariant). */
.mp-hero__scrim {
  position: absolute; inset: 0;
  background: linear-gradient(to top, rgba(0,0,0,0.72) 0%, rgba(0,0,0,0.34) 46%, rgba(0,0,0,0.04) 100%);
}
.mp-hero__content { position: relative; z-index: 1; padding: 26px; display: grid; gap: 12px; color: #fff; }
@media (min-width: 880px) { .mp-hero__content { padding: 34px; max-width: 760px; } }
.mp-hero__badges { display: flex; align-items: center; gap: 10px; }
.mp-hero__title { font: 800 clamp(26px, 4vw, 40px)/1.12 var(--font-sans); letter-spacing: -0.02em; margin: 0; color: inherit; }
.mp-hero__sci { font: italic var(--weight-regular) 0.62em var(--font-sans); opacity: 0.85; }
.mp-hero__excerpt { margin: 0; font: 16px/1.55 var(--font-sans); max-width: 60ch; color: rgba(255,255,255,0.92); }
.mp-hero__meta { font: 600 12px var(--font-sans); color: rgba(255,255,255,0.82); }
.mp-hero__byline { margin-top: 4px; }
/* Byline text sits on the dark scrim → force light ink for the name/role in the hero context. */
.mp-hero__byline :deep(.mp-byline__name) { color: #fff; }
.mp-hero__byline :deep(.mp-byline__role) { color: rgba(255,255,255,0.85); }

/* No-cover degrade: solid surface band, dark ink from tokens (no scrim, no white text). */
.mp-hero--nocover { background: var(--surface-sunken); border: 1px solid var(--border-subtle); }
.mp-hero--nocover .mp-hero__content { color: var(--text-strong); }
.mp-hero--nocover .mp-hero__excerpt { color: var(--text-muted); }
.mp-hero--nocover .mp-hero__meta { color: var(--text-faint); }
.mp-hero--nocover .mp-hero__byline :deep(.mp-byline__name) { color: var(--text-strong); }
.mp-hero--nocover .mp-hero__byline :deep(.mp-byline__role) { color: var(--text-muted); }

/* BODY LAYOUT */
.mp-article__layout { display: grid; gap: 24px; }
.mp-article-body { max-width: 720px; min-width: 0; }
/* When there is no TOC the body centers in the column. */
.mp-article__layout:not(.mp-article__layout--withtoc) .mp-article-body { margin: 0 auto; }
@media (min-width: 1024px) {
  .mp-article__layout--withtoc {
    grid-template-columns: 232px minmax(0, 1fr);
    gap: 44px; align-items: start;
  }
  /* Sticky rail below the sticky topbar (z-index 30 at top:0). top offset ≈ topbar height + breathing
     room — verify the exact value in the Phase 3 real-browser review. */
  .mp-article__toc { position: sticky; top: 96px; max-height: calc(100vh - 120px); overflow-y: auto; }
}

.mp-article__empty { color: var(--text-muted); margin-top: 16px; }
.mp-article__video { position: relative; aspect-ratio: 16 / 9; margin-top: 26px; border-radius: 14px; overflow: hidden; }
.mp-article__video iframe { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; }

/* Prominent CTA panel */
.mp-cta { margin-top: 34px; display: grid; gap: 14px; justify-items: start; }
.mp-cta__lead { font: 700 clamp(16px, 2vw, 19px) var(--font-sans); color: var(--text-strong); }
.mp-cta__btn {
  display: inline-flex; align-items: center; gap: 8px;
  padding: 12px 22px; border-radius: var(--radius-md);
  background: var(--brand-primary); color: var(--text-on-brand);
  font: 700 15px var(--font-sans); text-decoration: none;
  transition: filter var(--dur-fast) var(--ease-out);
}
.mp-cta__btn:hover { filter: brightness(0.94); }

.mp-notfound { max-width: 520px; margin: 40px auto; }
.mp-notfound__title { font: 700 16px var(--font-sans); color: var(--text-strong); }
.mp-notfound__lead { margin: 6px 0 12px; font: 14px var(--font-sans); color: var(--text-muted); }
.mp-notfound__back { margin-bottom: 0; }
</style>
