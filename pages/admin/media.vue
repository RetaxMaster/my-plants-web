<script setup lang="ts">
import type { MediaAssetView } from '../../types/api.js';
import { formatFileSize } from '../../utils/fileSize.js';
import { formatBlogDate } from '../../utils/blogDate.js';

const { t, locale } = useI18n();
const { user } = useUserSession();
if (user.value?.role !== 'ADMIN') {
  throw createError({ statusCode: 404, statusMessage: t('admin.pageNotFound') });
}

useHead(() => ({ title: t('meta.media.title') }));
useSeoMeta({ description: () => t('meta.media.description') });

const api = useApi();
const page = ref(1);
const { data, refresh } = await useAsyncData(
  'admin-media',
  () => api.listMedia(page.value),
  { watch: [page] },
);

const assets = computed<MediaAssetView[]>(() => data.value?.items ?? []);
const totalPages = computed(() => data.value?.totalPages ?? 1);

// Upload adapter: this page owns the endpoint glue; ImageUploadField owns the UX. On success the
// gallery refreshes so the new asset appears.
const mediaUpload = (file: File) => {
  const f = new FormData();
  f.append('image', file);
  return api.uploadMedia(f).then((asset) => {
    refresh();
    return { url: asset.imageUrl };
  });
};

const notice = ref<string | null>(null);
let noticeTimer: ReturnType<typeof setTimeout> | undefined;
function say(msg: string) {
  notice.value = msg;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => (notice.value = null), 4000);
}
onBeforeUnmount(() => clearTimeout(noticeTimer));

const confirmId = ref<string | null>(null);
const busy = ref<string | null>(null);
const copiedId = ref<string | null>(null);

async function copy(asset: MediaAssetView) {
  await navigator.clipboard.writeText(asset.imageUrl);
  copiedId.value = asset.id;
  setTimeout(() => (copiedId.value = null), 2000);
}

async function remove(asset: MediaAssetView) {
  busy.value = asset.id;
  try {
    await api.deleteMedia(asset.id);
    confirmId.value = null;
    await refresh();
    say(t('blog.media.deleted'));
  } catch {
    say(t('blog.media.deleteError'));
  } finally {
    busy.value = null;
  }
}

function goToPage(p: number) {
  if (p >= 1 && p <= totalPages.value) page.value = p;
}
</script>

<template>
  <div>
    <UiScreenHeader :eyebrow="$t('blog.media.eyebrow')" :title="$t('blog.media.title')" :subtitle="$t('blog.media.subtitle')" />

    <UiAlert v-if="notice" color="green" icon="check-circle" :title="notice" class="mp-media-notice" />

    <UiCard class="mp-media-upload" padded>
      <UiImageUploadField :upload="mediaUpload" :label="$t('blog.media.uploadLabel')" :hint="$t('blog.media.uploadHint')" />
    </UiCard>

    <UiSectionTitle class="mp-media-gallerytitle">{{ $t('blog.media.galleryTitle') }}</UiSectionTitle>

    <UiEmptyState v-if="!assets.length" icon="photo">{{ $t('blog.media.empty') }}</UiEmptyState>

    <div v-else class="mp-media-grid">
      <UiCard v-for="asset in assets" :key="asset.id" padded>
        <img :src="asset.imageUrl" :alt="asset.filename" class="mp-media-thumb" />
        <div class="mp-media-name">{{ asset.filename }}</div>
        <div class="mp-media-meta">{{ formatFileSize(asset.sizeBytes) }} · {{ formatBlogDate(locale, asset.createdAt) }}</div>

        <div v-if="confirmId === asset.id" class="mp-media-confirm">
          <span>{{ $t('blog.media.confirmDelete') }}</span>
          <UiButton size="xs" variant="solid" class="mp-btn-danger" :loading="busy === asset.id" @click="remove(asset)">
            {{ $t('blog.media.confirmDeleteYes') }}
          </UiButton>
          <UiButton size="xs" variant="ghost" color="neutral" @click="confirmId = null">
            {{ $t('blog.media.confirmDeleteNo') }}
          </UiButton>
        </div>
        <div v-else class="mp-media-actions">
          <UiButton size="xs" variant="soft" icon="clipboard" @click="copy(asset)">
            {{ copiedId === asset.id ? $t('blog.media.copied') : $t('blog.media.copyLink') }}
          </UiButton>
          <UiButton size="xs" variant="ghost" color="neutral" icon="trash" :aria-label="$t('blog.media.delete')" @click="confirmId = asset.id" />
        </div>
      </UiCard>
    </div>

    <nav v-if="totalPages > 1" class="mp-media-pagination" :aria-label="$t('blog.pagination')">
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
.mp-media-notice { margin-bottom: 16px; }
.mp-media-upload { max-width: 560px; margin-bottom: 30px; }
.mp-media-gallerytitle { margin-bottom: 14px; }
.mp-media-grid { display: grid; gap: 14px; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); }
.mp-media-thumb { width: 100%; aspect-ratio: 4 / 3; object-fit: cover; border-radius: var(--radius-md); border: 1px solid var(--border-subtle); }
.mp-media-name { font: 600 13px var(--font-sans); color: var(--text-strong); margin-top: 10px; word-break: break-all; }
.mp-media-meta { font: 12px var(--font-sans); color: var(--text-faint); margin: 2px 0 10px; }
.mp-media-actions, .mp-media-confirm { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.mp-media-confirm span { font: 600 12px var(--font-sans); color: var(--care-poor-text, var(--text-strong)); flex: 1 1 100%; }
.mp-media-pagination { display: flex; align-items: center; justify-content: center; gap: 14px; margin-top: 24px; }
.mp-meta-line { font: 600 12px var(--font-sans); color: var(--text-faint); }
</style>
