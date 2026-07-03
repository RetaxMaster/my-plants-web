<script setup lang="ts">
import type { BlogpostAdminRow } from '../../../types/api.js';

const { t } = useI18n();
const { user } = useUserSession();
// Inline admin gate (same pattern as pages/admin/index.vue). The API RolesGuard is the real boundary.
if (user.value?.role !== 'ADMIN') {
  throw createError({ statusCode: 404, statusMessage: t('admin.pageNotFound') });
}

const api = useApi();

const statusKey = ref<'all' | 'draft' | 'published'>('all');
const statusOptions = computed(() => [
  { key: 'all', label: t('blog.writingDesk.filterAll') },
  { key: 'draft', label: t('blog.writingDesk.filterDrafts') },
  { key: 'published', label: t('blog.writingDesk.filterPublished') },
]);
const statusParam = computed<0 | 1 | undefined>(() =>
  statusKey.value === 'draft' ? 0 : statusKey.value === 'published' ? 1 : undefined,
);

const q = ref('');
const debouncedQ = ref('');
let debounceTimer: ReturnType<typeof setTimeout> | undefined;
watch(q, (v) => {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => (debouncedQ.value = v.trim()), 300);
});

const page = ref(1);
watch([statusParam, debouncedQ], () => (page.value = 1));

const { data, refresh } = await useAsyncData(
  'admin-blogposts',
  () => api.listBlogposts({ status: statusParam.value, q: debouncedQ.value || undefined, page: page.value }),
  { watch: [statusParam, debouncedQ, page] },
);

const rows = computed<BlogpostAdminRow[]>(() => data.value?.items ?? []);
const totalPages = computed(() => data.value?.totalPages ?? 1);

// Transient toast.
const notice = ref<string | null>(null);
let noticeTimer: ReturnType<typeof setTimeout> | undefined;
function say(msg: string) {
  notice.value = msg;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => (notice.value = null), 5000);
}
onBeforeUnmount(() => {
  clearTimeout(debounceTimer);
  clearTimeout(noticeTimer);
});

const shortTitle = (row: BlogpostAdminRow) =>
  row.titleEs.length > 36 ? `${row.titleEs.slice(0, 36).trim()}…` : row.titleEs || t('blog.writingDesk.newTitle');

const confirmSlug = ref<string | null>(null);
const busy = ref<string | null>(null);

async function setStatus(row: BlogpostAdminRow, status: 0 | 1) {
  busy.value = row.slug;
  try {
    await api.updateBlogpost(row.slug, { status });
    await refresh();
    say(status === 1 ? t('blog.writingDesk.published', { title: shortTitle(row) }) : t('blog.writingDesk.unpublished', { title: shortTitle(row) }));
  } catch {
    say(t('blog.writingDesk.actionError'));
  } finally {
    busy.value = null;
  }
}

async function remove(row: BlogpostAdminRow) {
  busy.value = row.slug;
  try {
    await api.deleteBlogpost(row.slug);
    confirmSlug.value = null;
    await refresh();
    say(t('blog.writingDesk.deleted', { title: shortTitle(row) }));
  } catch (e: any) {
    // A species-linked post cannot be deleted (API 409). Surface the friendly message.
    confirmSlug.value = null;
    const code = e?.data?.code ?? e?.response?._data?.code;
    say(code === 'blogpost_species_linked_undeletable' ? t('blog.writingDesk.speciesLocked') : t('blog.writingDesk.actionError'));
  } finally {
    busy.value = null;
  }
}

async function newPost() {
  // The API requires non-empty ES title/excerpt/body (min(1)); seed placeholders, then open the editor.
  const created = await api.createBlogpost({
    titleEs: t('blog.writingDesk.newTitle'),
    excerptEs: t('blog.writingDesk.newExcerpt'),
    bodyEs: t('blog.writingDesk.newBody'),
  });
  await navigateTo(`/admin/blog/${created.slug}`);
}

function goToPage(p: number) {
  if (p >= 1 && p <= totalPages.value) page.value = p;
}
</script>

<template>
  <div>
    <div class="mp-desk-head">
      <UiScreenHeader :eyebrow="$t('blog.writingDesk.eyebrow')" :title="$t('blog.writingDesk.title')" :subtitle="$t('blog.writingDesk.subtitle')" />
      <UiButton icon="plus" @click="newPost">{{ $t('blog.writingDesk.newPost') }}</UiButton>
    </div>

    <UiAlert v-if="notice" color="green" icon="check-circle" :title="notice" class="mp-desk-notice" />

    <div class="mp-desk-controls">
      <UiInput v-model="q" icon="magnifying-glass" :placeholder="$t('blog.writingDesk.search')" />
      <UiSegmentedControl v-model="statusKey" :options="statusOptions" :aria-label="$t('blog.writingDesk.filterAll')" />
    </div>

    <UiEmptyState v-if="!rows.length" icon="sparkles">
      {{ debouncedQ || statusKey !== 'all' ? $t('blog.writingDesk.emptyFiltered') : $t('blog.writingDesk.empty') }}
    </UiEmptyState>

    <div v-else class="mp-desk-list">
      <UiCard v-for="row in rows" :key="row.slug" padded>
        <div class="mp-postrow">
          <NuxtLink :to="`/admin/blog/${row.slug}`" class="mp-postrow__thumb mp-clickable">
            <img v-if="row.coverImageUrl" :src="row.coverImageUrl" :alt="row.titleEs" />
            <div v-else class="mp-postrow__ph"><UiAppIcon name="photo" :size="20" color="var(--text-faint)" /></div>
          </NuxtLink>

          <NuxtLink :to="`/admin/blog/${row.slug}`" class="mp-postrow__info mp-clickable">
            <div class="mp-postrow__title">{{ row.titleEs || $t('blog.writingDesk.newTitle') }}</div>
            <div class="mp-postrow__slug">/blog/{{ row.slug }}</div>
            <div class="mp-postrow__excerpt">{{ row.excerptEs }}</div>
          </NuxtLink>

          <div class="mp-postrow__aside">
            <div class="mp-postrow__status">
              <UiBadge :color="row.status === 1 ? 'green' : 'neutral'" size="xs" :dot="row.status === 1">
                {{ $t(`blog.status.${row.status}`) }}
              </UiBadge>
            </div>

            <div v-if="confirmSlug === row.slug" class="mp-postrow__confirm">
              <span>{{ $t('blog.writingDesk.confirmDelete') }}</span>
              <UiButton size="xs" variant="solid" class="mp-btn-danger" :loading="busy === row.slug" @click="remove(row)">
                {{ $t('blog.writingDesk.confirmDeleteYes') }}
              </UiButton>
              <UiButton size="xs" variant="ghost" color="neutral" @click="confirmSlug = null">
                {{ $t('blog.writingDesk.confirmDeleteNo') }}
              </UiButton>
            </div>

            <div v-else class="mp-postrow__actions">
              <UiButton
                v-if="row.status === 1"
                size="xs" variant="ghost" color="neutral" icon="arrow-down-circle"
                :loading="busy === row.slug" @click="setStatus(row, 0)"
              >{{ $t('blog.writingDesk.unpublish') }}</UiButton>
              <UiButton
                v-else
                size="xs" variant="soft" icon="arrow-up-circle"
                :loading="busy === row.slug" @click="setStatus(row, 1)"
              >{{ $t('blog.writingDesk.publish') }}</UiButton>

              <!-- Delete is hidden for species-linked posts (they can't be deleted; the 409 is also handled). -->
              <UiButton
                v-if="row.speciesSlug === null"
                size="xs" variant="ghost" color="neutral" icon="trash"
                :aria-label="$t('blog.writingDesk.delete')" @click="confirmSlug = row.slug"
              />

              <UiButton
                size="xs" variant="soft" :color="row.status === 1 ? 'neutral' : 'primary'"
                trailing-icon="chevron-right" @click="navigateTo(`/admin/blog/${row.slug}`)"
              >{{ row.status === 1 ? $t('blog.writingDesk.edit') : $t('blog.writingDesk.keepWriting') }}</UiButton>
            </div>
          </div>
        </div>
      </UiCard>
    </div>

    <nav v-if="totalPages > 1" class="mp-desk-pagination" :aria-label="$t('blog.pagination')">
      <UiButton size="sm" variant="soft" color="neutral" icon="chevron-left" :disabled="page <= 1" @click="goToPage(page - 1)">
        {{ $t('blog.previous') }}
      </UiButton>
      <span class="mp-meta-line">{{ $t('blog.pageOf', { page, total: totalPages }) }}</span>
      <UiButton size="sm" variant="soft" color="neutral" trailing-icon="chevron-right" :disabled="page >= totalPages" @click="goToPage(page + 1)">
        {{ $t('blog.next') }}
      </UiButton>
    </nav>
  </div>
</template>

<style scoped>
.mp-desk-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
.mp-desk-notice { margin-bottom: 16px; }
.mp-desk-controls { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; margin: 4px 0 24px; }
.mp-desk-controls > :first-child { flex: 1 1 320px; max-width: 460px; }
.mp-desk-list { display: grid; gap: 12px; }

.mp-postrow { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
.mp-postrow__thumb { flex: none; width: 104px; height: 66px; border-radius: 10px; overflow: hidden; border: 1px solid var(--border-subtle); }
.mp-postrow__thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
.mp-postrow__ph { width: 100%; height: 100%; display: grid; place-items: center; background: var(--surface-sunken); }
.mp-postrow__info { flex: 1 1 260px; min-width: 200px; text-decoration: none; }
.mp-postrow__title { font: 700 15px var(--font-sans); color: var(--text-strong); letter-spacing: -0.01em; }
.mp-postrow__slug { font: 11px var(--font-mono); color: var(--text-faint); margin: 3px 0 5px; word-break: break-all; }
.mp-postrow__excerpt { font: 13px var(--font-sans); color: var(--text-muted); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.mp-postrow__aside { margin-left: auto; display: flex; flex-direction: column; align-items: flex-end; gap: 10px; flex: none; }
.mp-postrow__actions, .mp-postrow__confirm { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; justify-content: flex-end; }
.mp-postrow__confirm span { font: 600 13px var(--font-sans); color: var(--care-poor-text, var(--text-strong)); }

.mp-desk-pagination { display: flex; align-items: center; justify-content: center; gap: 14px; margin-top: 28px; }
.mp-meta-line { font: 600 12px var(--font-sans); color: var(--text-faint); }
</style>
