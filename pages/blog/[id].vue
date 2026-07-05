<script setup lang="ts">
import type { BlogpostDetail, BlogpostAdminDetail } from '../../types/api.js';
import { pickLocalized } from '../../utils/localizedField.js';
import { renderArticle } from '../../utils/renderArticle.js';
import { youtubeEmbedUrl } from '../../utils/youtube.js';
import { formatBlogDateFull } from '../../utils/blogDate.js';
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
const dateLabel = computed(() => (view.value ? formatBlogDateFull(locale.value, view.value.dateIso) : ''));
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
  <div v-if="view" class="mp-article-page">
    <!-- Reading progress: fixed at the very top edge, tracks the article element. -->
    <UiReadingProgress target=".mp-article" />

    <!-- HERO (full-bleed): the cover fills the width behind a legibility scrim; the eyebrow, title,
         excerpt and author byline stack on top. Degrades to a solid band with no cover. -->
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
      <div class="mp-hero__inner">
        <button type="button" class="mp-hero__back" @click="navigateTo('/blog')">
          <UiAppIcon name="chevron-left" :size="15" color="currentColor" />
          {{ $t('blog.allArticles') }}
        </button>

        <div class="mp-hero__foot">
          <div v-if="isDraft" class="mp-hero__draft">
            <UiAppIcon name="eye" :size="14" color="currentColor" /> {{ $t('blog.preview.draftBanner') }}
          </div>
          <div class="mp-hero__badges">
            <UiBadge color="green" size="sm" dot>{{ $t('blog.careGuide') }}</UiBadge>
            <UiBadge v-if="view.difficulty" color="cafe" size="sm">{{ view.difficulty }}</UiBadge>
          </div>
          <h1 class="mp-hero__title">
            {{ title }}
            <span v-if="view.speciesScientificName" class="mp-hero__sci">({{ view.speciesScientificName }})</span>
          </h1>
          <p v-if="excerpt" class="mp-hero__excerpt">{{ excerpt }}</p>
          <UiAuthorByline
            :name="author.name"
            :handle="author.handle"
            :avatar="author.avatar"
            :size="44"
            class="mp-hero__byline"
          >
            <template #meta>{{ dateLabel }} · {{ $t('blog.minRead', { min: readingMin }) }}</template>
          </UiAuthorByline>
        </div>
      </div>
    </header>

    <!-- BODY: a centered reading block; the índice is a sticky rail to the LEFT on wide screens. -->
    <div class="mp-article-wrap" :class="{ 'mp-article-wrap--withtoc': toc.length }">
      <aside v-if="toc.length" class="mp-article-rail">
        <UiArticleToc :items="toc" :title="$t('blog.toc')" />
      </aside>

      <article class="mp-article">
        <div v-if="embedUrl" class="mp-article__video">
          <iframe
            :src="embedUrl"
            :title="$t('blog.watchVideo')"
            loading="lazy"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowfullscreen
          />
        </div>

        <p v-if="!body" class="mp-article__empty">{{ $t('blog.noArticle') }}</p>
        <UiProse v-else :html="articleHtml" />

        <!-- Prominent final CTA: eyebrow + display title + a large pill action with a hover sheen. -->
        <div v-if="ctaHref && ctaLabel" class="mp-postcta">
          <span class="mp-postcta__eyebrow">{{ $t('blog.cta.eyebrow') }}</span>
          <h2 class="mp-postcta__title">{{ $t('blog.cta.lead') }}<span class="mp-postcta__dot">.</span></h2>
          <div class="mp-postcta__btnwrap">
            <a class="mp-postcta__link" :href="ctaHref" target="_blank" rel="noopener noreferrer">
              <span class="mp-postcta__sheen" aria-hidden="true" />
              <span class="mp-postcta__label">{{ ctaLabel }}</span>
              <span class="mp-postcta__arrow" aria-hidden="true">→</span>
            </a>
          </div>
        </div>

        <!-- Author sign-off: the same byline as the hero, closing the article. -->
        <footer class="mp-article__sign">
          <UiAuthorByline :name="author.name" :handle="author.handle" :avatar="author.avatar" :size="52">
            <template #role>{{ $t('blog.author.role') }}</template>
          </UiAuthorByline>
        </footer>
      </article>
    </div>
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
/* ============ HERO (full-bleed) ============
   Breaks out of the app-shell's centered, padded column: 100vw wide, pulled up under the topbar. */
.mp-hero {
  position: relative;
  width: 100vw;
  margin-left: calc(50% - 50vw);
  margin-top: -26px; /* cancel the shell's top padding so the cover pins to the topbar */
  min-height: max(440px, 52vh);
  overflow: hidden;
  display: flex;
  background: var(--surface-sunken);
}
.mp-hero__img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; display: block; }
/* Legibility scrim — a translucent dark gradient (rgba, not a brand color), NOT a blur (perf invariant). */
.mp-hero__scrim {
  position: absolute; inset: 0; pointer-events: none;
  background: linear-gradient(to top, rgba(0,0,0,0.80) 0%, rgba(0,0,0,0.46) 40%, rgba(0,0,0,0.14) 78%, rgba(0,0,0,0.20) 100%);
}
.mp-hero__inner {
  position: relative; z-index: 1;
  width: 100%; max-width: 1180px; margin: 0 auto;
  padding: 24px 22px 42px;
  display: flex; flex-direction: column; justify-content: flex-end;
  gap: 16px; color: #fff;
}
.mp-hero__back {
  align-self: flex-start; margin-bottom: auto; /* sits at the top; content stays at the bottom */
  display: inline-flex; align-items: center; gap: 5px;
  padding: 6px 13px; border-radius: var(--radius-pill);
  background: rgba(0,0,0,0.32); border: 1px solid rgba(255,255,255,0.22);
  color: #fff; font: var(--weight-medium) 12px var(--font-sans); cursor: pointer;
  transition: background var(--dur-fast) var(--ease-out);
}
.mp-hero__back:hover { background: rgba(0,0,0,0.5); }
.mp-hero__foot { display: flex; flex-direction: column; gap: 14px; max-width: 760px; }
.mp-hero__draft {
  align-self: flex-start; display: inline-flex; align-items: center; gap: 6px;
  padding: 5px 11px; border-radius: var(--radius-pill);
  background: rgba(255,255,255,0.16); color: #fff; font: var(--weight-semibold) 11px var(--font-sans);
}
.mp-hero__badges { display: flex; align-items: center; gap: 10px; }
.mp-hero__title {
  margin: 0; font: var(--weight-extra) clamp(28px, 4.4vw, 46px)/1.1 var(--font-sans);
  letter-spacing: -0.025em; color: inherit;
}
.mp-hero__sci { font: italic var(--weight-regular) 0.6em var(--font-sans); opacity: 0.85; }
.mp-hero__excerpt { margin: 0; font: 16px/1.6 var(--font-sans); max-width: 62ch; color: rgba(255,255,255,0.92); }
.mp-hero__byline { margin-top: 4px; }
/* The byline sits on the dark scrim → light ink for name/meta; the @handle keeps the brand color. */
.mp-hero__byline :deep(.mp-byline__name) { color: #fff; }
.mp-hero__byline :deep(.mp-byline__meta) { color: rgba(255,255,255,0.72); }

/* No-cover degrade: solid surface band, dark ink from tokens (no scrim, no white text). */
.mp-hero--nocover { background: var(--surface-sunken); border: 1px solid var(--border-subtle); }
.mp-hero--nocover .mp-hero__inner { color: var(--text-strong); }
.mp-hero--nocover .mp-hero__back { background: var(--surface-card); border-color: var(--border-subtle); color: var(--text-body); }
.mp-hero--nocover .mp-hero__draft { background: var(--brand-accent-subtle); color: var(--accent-cafe-ink); }
.mp-hero--nocover .mp-hero__excerpt { color: var(--text-muted); }
.mp-hero--nocover .mp-hero__byline :deep(.mp-byline__name) { color: var(--text-strong); }
.mp-hero--nocover .mp-hero__byline :deep(.mp-byline__meta) { color: var(--text-faint); }

/* ============ BODY ============
   Centered reading block (max-width), with the sticky índice rail to the left on wide screens. */
.mp-article-wrap { max-width: 1180px; margin: 0 auto; padding: 48px 0 72px; }
@media (min-width: 1024px) {
  .mp-article-wrap--withtoc {
    display: flex; gap: 52px; align-items: flex-start; justify-content: center;
  }
  /* Sticky on the ASIDE itself (not a child) so it has the full grid height to travel through. */
  .mp-article-rail {
    position: sticky; top: 96px; flex: 0 0 214px;
    max-height: calc(100vh - 120px); overflow-y: auto;
  }
  .mp-article { flex: 0 1 760px; min-width: 0; }
}
/* No TOC (or narrow): the article centers within the reading width. */
.mp-article-wrap:not(.mp-article-wrap--withtoc) .mp-article,
.mp-article { max-width: 760px; margin: 0 auto; }
@media (max-width: 1023px) { .mp-article-rail { display: none; } }

.mp-article__empty { color: var(--text-muted); margin-top: 16px; }
.mp-article__video { position: relative; aspect-ratio: 16 / 9; margin-bottom: 28px; border-radius: var(--radius-lg); overflow: hidden; border: 1px solid var(--border-subtle); }
.mp-article__video iframe { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; }

/* ============ Prominent final CTA ============ */
.mp-postcta {
  display: flex; flex-direction: column; align-items: center; text-align: center; gap: 14px;
  margin-top: 52px; padding: 46px 20px 8px; border-top: 1px solid var(--border-subtle);
}
.mp-postcta__eyebrow {
  font: var(--weight-medium) 10.5px var(--font-mono); letter-spacing: 0.14em; text-transform: uppercase;
  color: var(--text-faint);
}
.mp-postcta__title {
  margin: 0; font: var(--weight-extra) clamp(24px, 3.4vw, 34px)/1.14 var(--font-sans);
  letter-spacing: -0.02em; color: var(--text-strong);
}
.mp-postcta__dot { color: var(--brand-primary); }
/* The wrapper carries the beacon and must NOT clip it (so the ring can expand OUTWARD past the pill).
   The pill itself keeps overflow:hidden for the sheen — that's why the beacon can't live on the pill. */
.mp-postcta__btnwrap { position: relative; display: inline-flex; margin-top: 8px; isolation: isolate; }
/* Beacon pulse: a SOFT brand-colored glow (a blurred shadow ring — NOT a solid fill) behind the pill
   that gently expands and fades on a loop, echoing the Retax reference's halo. The box-shadow is
   STATIC; only transform + opacity animate (on a promoted layer), so it respects the perf invariant
   (no animated shadow, no paint/layout animation in the loop). No `background` → it reads as a halo
   around the pill, never a hard green block. */
.mp-postcta__btnwrap::before {
  content: ''; position: absolute; inset: 0; z-index: 0; border-radius: var(--radius-pill);
  pointer-events: none; will-change: transform, opacity;
  /* ONLY a diffuse blurred glow — no solid ring/spread (a hard spread reads as a green frame). Two
     blurred layers (a wider soft halo + a tighter brighter one) give it presence without a hard edge. */
  box-shadow:
    0 0 26px 5px color-mix(in srgb, var(--brand-primary) 55%, transparent),
    0 0 10px 1px color-mix(in srgb, var(--brand-primary) 45%, transparent);
  animation: mp-cta-beacon 2.6s cubic-bezier(0.22, 0.61, 0.2, 1) infinite;
}
@keyframes mp-cta-beacon {
  0% { transform: scale(0.9); opacity: 0.9; }
  70%, 100% { transform: scale(1.22); opacity: 0; }
}
.mp-postcta__link {
  position: relative; z-index: 1;
  display: inline-flex; align-items: center; gap: 10px;
  padding: 14px 30px; border-radius: var(--radius-pill);
  background: var(--brand-primary); color: var(--text-on-brand);
  font: var(--weight-semibold) 15px var(--font-sans); text-decoration: none; overflow: hidden;
  transition: transform var(--dur-fast) var(--ease-out), background var(--dur-fast) var(--ease-out);
}
.mp-postcta__link:hover { transform: translateY(-2px); background: var(--brand-primary-hover); }
/* Sheen sweeps periodically (like the reference) — TRANSFORM only. */
.mp-postcta__sheen {
  position: absolute; top: 0; bottom: 0; left: 0; width: 45%; pointer-events: none;
  transform: translateX(-180%) skewX(-18deg);
  background: linear-gradient(90deg, transparent, rgba(255,255,255,0.28), transparent);
  animation: mp-cta-sheen 4.2s cubic-bezier(0.22, 0.61, 0.2, 1) infinite;
}
@keyframes mp-cta-sheen {
  0%, 55% { transform: translateX(-180%) skewX(-18deg); }
  100% { transform: translateX(360%) skewX(-18deg); }
}
.mp-postcta__label { position: relative; }
/* Arrow nudges out periodically + a little extra on hover. */
.mp-postcta__arrow {
  position: relative; display: inline-block;
  animation: mp-cta-nudge 1.7s ease-in-out infinite;
}
@keyframes mp-cta-nudge { 0%, 100% { transform: translateX(0); } 50% { transform: translateX(4px); } }
.mp-postcta__link:hover .mp-postcta__arrow { transform: translateX(4px); }
@media (prefers-reduced-motion: reduce) {
  .mp-postcta__link:hover { transform: none; }
  .mp-postcta__btnwrap::before,
  .mp-postcta__sheen,
  .mp-postcta__arrow { animation: none; }
}

/* Author sign-off at the article's end */
.mp-article__sign {
  margin-top: 48px; padding-top: 26px; border-top: 1px solid var(--border-subtle);
}

/* ============ Not found ============ */
.mp-notfound { max-width: 520px; margin: 40px auto; }
.mp-notfound__title { font: 700 16px var(--font-sans); color: var(--text-strong); }
.mp-notfound__lead { margin: 6px 0 12px; font: 14px var(--font-sans); color: var(--text-muted); }
.mp-notfound__back { margin-bottom: 0; }
</style>
