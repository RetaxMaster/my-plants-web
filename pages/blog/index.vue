<script setup lang="ts">
import type { BlogpostCard, BlogpostAdminRow } from '../../types/api.js';
import { pickLocalized } from '../../utils/localizedField.js';
import { formatBlogDate } from '../../utils/blogDate.js';

const api = useApi();
const { locale } = useI18n();
const { user } = useUserSession();
const route = useRoute();
const router = useRouter();

const PAGE_SIZE = 10;

// The magazine paginates via ?page= (shareable/SEO-friendly). Locale is NOT in the URL — separate rule.
const page = computed(() => {
  const raw = Number.parseInt(String(route.query.page ?? '1'), 10);
  return Number.isFinite(raw) && raw >= 1 ? raw : 1;
});

const isAdmin = computed(() => user.value?.role === 'ADMIN');

const { data } = await useAsyncData(
  () => `blog-feed-${page.value}`,
  () => api.listBlog(page.value, PAGE_SIZE),
  { watch: [page] },
);

// Admin-only draft overlay. Fetched once (page 1 of the drafts list); for non-admins it resolves null
// (never calls the RolesGuard endpoint). Surfaced only on the magazine's page 1 (see the merge below).
const { data: draftsData } = await useAsyncData(
  'blog-drafts',
  () => (isAdmin.value ? api.listBlogposts({ status: 0 }) : Promise.resolve(null)),
  { watch: [isAdmin] },
);

// One card shape for the "more guides" list, regardless of source. A DRAFT honestly carries less:
// no reading time, no difficulty, no species (the admin row has none) — the template renders those
// only when non-null, so nothing is fabricated.
interface FeedCard {
  kind: 'published' | 'draft';
  slug: string;
  titleEs: string; titleEn: string | null;
  excerptEs: string; excerptEn: string | null;
  coverImageUrl: string | null;
  dateIso: string | null;               // shown in the meta line
  sortDate: string | null;              // ordering key (publishedAt or updatedAt)
  readingMinutes: number | null;
  speciesScientificName: string | null;
  difficulty: string | null;
}

function toPublishedCard(c: BlogpostCard): FeedCard {
  return {
    kind: 'published',
    slug: c.slug,
    titleEs: c.titleEs, titleEn: c.titleEn,
    excerptEs: c.excerptEs, excerptEn: c.excerptEn,
    coverImageUrl: c.coverImageUrl,
    dateIso: c.publishedAt, sortDate: c.publishedAt,
    readingMinutes: c.readingMinutes,
    speciesScientificName: c.speciesScientificName,
    difficulty: c.difficulty,
  };
}

function toDraftCard(r: BlogpostAdminRow): FeedCard {
  return {
    kind: 'draft',
    slug: r.slug,
    titleEs: r.titleEs, titleEn: null,      // no EN on the admin row
    excerptEs: r.excerptEs, excerptEn: null,
    coverImageUrl: r.coverImageUrl,
    dateIso: r.updatedAt, sortDate: r.updatedAt,
    readingMinutes: null,                   // no body to estimate from on the row
    speciesScientificName: null,            // not on the row
    difficulty: null,                       // not on the row
  };
}

const publishedItems = computed<BlogpostCard[]>(() => data.value?.items ?? []);
// The featured slot is the newest PUBLISHED post — page 1 only, never a draft.
const featured = computed<BlogpostCard | null>(() => (page.value === 1 ? publishedItems.value[0] ?? null : null));

// Descending by effective date; nulls sort last.
function byDateDesc(a: FeedCard, b: FeedCard): number {
  const ta = a.sortDate ? Date.parse(a.sortDate) : -Infinity;
  const tb = b.sortDate ? Date.parse(b.sortDate) : -Infinity;
  return tb - ta;
}

const rest = computed<FeedCard[]>(() => {
  const publishedRest = (page.value === 1 ? publishedItems.value.slice(1) : publishedItems.value).map(toPublishedCard);
  // Drafts only merge on page 1 (freshest view); deeper pages stay the published feed.
  if (!isAdmin.value || page.value !== 1) return publishedRest;
  const draftCards = (draftsData.value?.items ?? []).map(toDraftCard);
  return [...publishedRest, ...draftCards].sort(byDateDesc);
});

const totalPages = computed(() => data.value?.totalPages ?? 1);
const total = computed(() => data.value?.total ?? 0);
const pageNumbers = computed(() => Array.from({ length: totalPages.value }, (_, i) => i + 1));
const hasItems = computed(() => !!featured.value || rest.value.length > 0);

const title = (c: { titleEs: string; titleEn: string | null }) =>
  pickLocalized(locale.value, c.titleEs, c.titleEn) ?? c.titleEs;
const excerpt = (c: { excerptEs: string; excerptEn: string | null }) =>
  pickLocalized(locale.value, c.excerptEs, c.excerptEn) ?? '';
const dateLabel = (iso: string | null) => formatBlogDate(locale.value, iso);

function goToPage(p: number) {
  if (p < 1 || p > totalPages.value || p === page.value) return;
  router.push({ query: p <= 1 ? {} : { page: String(p) } });
}
</script>

<template>
  <div>
    <!-- hero -->
    <div class="mp-bloghero">
      <div class="mp-eyebrow">{{ $t('blog.eyebrow') }}</div>
      <div class="mp-bloghero__row">
        <h1 class="mp-bloghero__title">
          {{ $t('blog.heroTitleLine1') }}<br />
          <span class="mp-bloghero__accent">{{ $t('blog.heroTitleLine2') }}</span>
        </h1>
        <NuxtLink v-if="isAdmin" to="/admin/blog" class="mp-bloghero__desk">
          <UiAppIcon name="pencil-square" :size="16" color="currentColor" />
          {{ $t('blog.writingDesk.eyebrow') }}
        </NuxtLink>
      </div>
      <p class="mp-bloghero__lead">{{ $t('blog.heroLead') }}</p>
    </div>

    <!-- empty -->
    <UiCard v-if="!hasItems" padded>
      <UiEmptyState>{{ $t('blog.empty') }}</UiEmptyState>
    </UiCard>

    <template v-else>
      <!-- featured (page 1 only, published) -->
      <div v-if="featured" class="mp-featured">
        <NuxtLink :to="`/blog/${featured.slug}`" class="mp-featured__cover mp-clickable">
          <img v-if="featured.coverImageUrl" :src="featured.coverImageUrl" :alt="title(featured)" />
          <div v-else class="mp-featured__ph"><UiAppIcon name="photo" :size="28" color="var(--text-faint)" /></div>
        </NuxtLink>
        <div class="mp-featured__body">
          <div class="mp-featured__meta">
            <UiBadge color="green" size="sm" dot>{{ $t('blog.featured') }}</UiBadge>
            <span class="mp-meta-line">{{ dateLabel(featured.publishedAt) }} · {{ $t('blog.minRead', { min: featured.readingMinutes }) }}</span>
          </div>
          <NuxtLink :to="`/blog/${featured.slug}`" class="mp-featured__title mp-clickable">{{ title(featured) }}</NuxtLink>
          <p class="mp-featured__excerpt">{{ excerpt(featured) }}</p>
          <div class="mp-featured__cta">
            <UiButton trailing-icon="arrow-right" @click="navigateTo(`/blog/${featured.slug}`)">
              {{ $t('blog.readGuide') }}
            </UiButton>
            <UiBadge v-if="featured.difficulty" color="cafe" size="sm">{{ featured.difficulty }}</UiBadge>
          </div>
        </div>
      </div>

      <!-- more guides (magazine list, alternating; drafts merged inline for admins) -->
      <div class="mp-more">
        <div class="mp-more__head">
          <div>
            <UiSectionTitle class="mp-more__title">{{ $t('blog.moreGuides') }}</UiSectionTitle>
            <p class="mp-more__sub">{{ $t('blog.moreGuidesSub') }}</p>
          </div>
          <span class="mp-meta-line">{{ $t('blog.guidesCount', { count: total }) }}</span>
        </div>

        <div class="mp-maglist">
          <NuxtLink
            v-for="(s, i) in rest"
            :key="s.slug"
            :to="`/blog/${s.slug}`"
            class="mp-magcard mp-clickable"
            :class="{ 'mp-magcard--rev': i % 2 === 1 }"
          >
            <div class="mp-magcard__thumb">
              <img v-if="s.coverImageUrl" :src="s.coverImageUrl" :alt="title(s)" />
              <div v-else class="mp-magcard__ph"><UiAppIcon name="photo" :size="24" color="var(--text-faint)" /></div>
            </div>
            <div class="mp-magcard__body">
              <div class="mp-meta-line">
                <template v-if="s.kind === 'draft'">{{ dateLabel(s.dateIso) }}</template>
                <template v-else>{{ dateLabel(s.dateIso) }} · {{ $t('blog.minRead', { min: s.readingMinutes }) }}</template>
              </div>
              <UiPlantName :title="title(s)" :scientific="s.speciesScientificName ?? undefined" :size="20" />
              <p class="mp-magcard__excerpt">{{ excerpt(s) }}</p>
              <div class="mp-magcard__foot">
                <UiBadge v-if="s.kind === 'draft'" color="neutral" size="xs">{{ $t('blog.status.0') }}</UiBadge>
                <UiBadge v-if="s.difficulty" color="cafe" size="xs">{{ s.difficulty }}</UiBadge>
                <span class="mp-readmore">{{ $t('blog.readGuide') }} <UiAppIcon name="arrow-right" :size="14" color="currentColor" /></span>
              </div>
            </div>
          </NuxtLink>
        </div>

        <!-- pagination (published feed) -->
        <nav v-if="totalPages > 1" class="mp-pagination" :aria-label="$t('blog.pagination')">
          <div class="mp-pagination__row">
            <UiButton size="sm" variant="soft" color="neutral" icon="chevron-left" :disabled="page <= 1" @click="goToPage(page - 1)">
              {{ $t('blog.previous') }}
            </UiButton>
            <div class="mp-pagination__nums">
              <button
                v-for="n in pageNumbers"
                :key="n"
                type="button"
                class="mp-pagenum"
                :aria-current="n === page ? 'page' : undefined"
                @click="goToPage(n)"
              >{{ n }}</button>
            </div>
            <UiButton size="sm" variant="soft" color="neutral" trailing-icon="chevron-right" :disabled="page >= totalPages" @click="goToPage(page + 1)">
              {{ $t('blog.next') }}
            </UiButton>
          </div>
          <span class="mp-meta-line">{{ $t('blog.pageOf', { page, total: totalPages }) }}</span>
        </nav>
      </div>
    </template>
  </div>
</template>

<style scoped>
.mp-bloghero { border-bottom: 1px solid var(--border-subtle); padding-bottom: 26px; margin-bottom: 30px; }
.mp-bloghero__row { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
.mp-bloghero__title { font: 800 clamp(30px, 5vw, 44px) var(--font-sans); letter-spacing: -0.02em; color: var(--text-strong); margin: 0; max-width: 22ch; }
.mp-bloghero__accent { color: var(--text-brand); }
.mp-bloghero__lead { margin: 12px 0 0; font: 15px/1.6 var(--font-sans); color: var(--text-muted); max-width: 56ch; }
.mp-bloghero__desk {
  display: inline-flex; align-items: center; gap: 6px; flex-shrink: 0;
  padding: 8px 14px; border-radius: var(--radius-pill);
  background: var(--accent-green-surface); color: var(--accent-green-ink);
  font: 600 13px var(--font-sans); text-decoration: none;
}

.mp-meta-line { font: 600 12px var(--font-sans); color: var(--text-faint); }

.mp-featured { display: flex; gap: 30px; align-items: center; flex-wrap: wrap; margin-bottom: 40px; }
.mp-featured__cover { flex: 1 1 380px; min-width: 280px; display: block; border-radius: 14px; overflow: hidden; box-shadow: var(--shadow-md); }
.mp-featured__cover img { width: 100%; aspect-ratio: 16 / 9; object-fit: cover; display: block; }
.mp-featured__ph { width: 100%; aspect-ratio: 16 / 9; display: grid; place-items: center; background: var(--surface-sunken); }
.mp-featured__body { flex: 1 1 320px; min-width: 260px; display: grid; gap: 10px; align-content: center; }
.mp-featured__meta { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.mp-featured__title { font: 800 clamp(22px, 3vw, 30px) var(--font-sans); letter-spacing: -0.02em; color: var(--text-strong); text-decoration: none; }
.mp-featured__excerpt { margin: 0; font: 14.5px/1.65 var(--font-sans); color: var(--text-muted); max-width: 54ch; }
.mp-featured__cta { display: flex; align-items: center; gap: 14px; margin-top: 4px; flex-wrap: wrap; }

.mp-more { border-top: 1px solid var(--border-subtle); padding-top: 26px; }
.mp-more__head { display: flex; align-items: flex-end; gap: 14px; flex-wrap: wrap; margin-bottom: 20px; }
.mp-more__head > span { margin-left: auto; }
.mp-more__title { margin: 0; }
.mp-more__sub { margin: 4px 0 0; font: 13px var(--font-sans); color: var(--text-muted); }

.mp-maglist { display: grid; gap: 26px; }
@media (min-width: 880px) { .mp-maglist { gap: 34px; } }
.mp-magcard { display: flex; gap: 24px; align-items: center; flex-wrap: wrap; text-decoration: none; }
.mp-magcard--rev { flex-direction: row-reverse; }
.mp-magcard__thumb { flex: 1 1 300px; min-width: 260px; border-radius: 12px; overflow: hidden; border: 1px solid var(--border-subtle); }
.mp-magcard__thumb img { width: 100%; aspect-ratio: 16 / 9; object-fit: cover; display: block; transition: transform var(--dur-fast) var(--ease-out); }
.mp-magcard:hover .mp-magcard__thumb img { transform: scale(1.03); }
.mp-magcard__ph { width: 100%; aspect-ratio: 16 / 9; display: grid; place-items: center; background: var(--surface-sunken); }
.mp-magcard__body { flex: 1 1 300px; min-width: 240px; display: grid; gap: 8px; align-content: center; }
.mp-magcard__excerpt { margin: 0; font: 14px/1.6 var(--font-sans); color: var(--text-muted); max-width: 52ch; }
.mp-magcard__foot { display: flex; align-items: center; gap: 12px; margin-top: 2px; }
.mp-readmore { display: inline-flex; align-items: center; gap: 6px; font: 600 13px var(--font-sans); color: var(--text-link, var(--green-600)); }

.mp-pagination { display: grid; justify-items: center; gap: 10px; border-top: 1px solid var(--border-subtle); margin-top: 34px; padding-top: 24px; }
.mp-pagination__row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; justify-content: center; }
.mp-pagination__nums { display: flex; align-items: center; gap: 6px; }
</style>
