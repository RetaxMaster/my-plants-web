<script setup lang="ts">
import type { ProgressEntryDetail, ProgressPhoto } from '../types/api.js';
import { ymdToLocalDate } from '../utils/localDate.js';

const props = defineProps<{ plantId: string; entryId: string | null }>();
const open = defineModel<boolean>({ default: false });

const api = useApi();
const { healthLabel } = useTaskMeta();
const { tagLabel } = useProgressTagMeta();
const entry = ref<ProgressEntryDetail | null>(null);
const loading = ref(false);

// Gallery is READY-only (spec §5.3): only a READY photo has a non-null imageUrl. The narrowing predicate
// keeps `p.imageUrl` a `string` for the <img>. (Task 14 adds the "still processing"/"failed" states.)
const readyPhotos = computed(() =>
  (entry.value?.photos ?? []).filter(
    (p): p is ProgressPhoto & { imageUrl: string } => p.status === 'READY' && p.imageUrl != null,
  ),
);

// Request token: opening entry A then quickly switching to entry B must not let A's slower response
// overwrite B. Each fetch stamps a token; a response only lands if it is still the latest request.
let requestToken = 0;
// `silent` = a manual "Actualizar" re-read (spec §6.2): re-fetch WITHOUT blanking the current entry or
// flashing the loading state, so the still-processing photos just swap in place once the worker finishes.
async function loadEntry(opts: { silent?: boolean } = {}) {
  const id = props.entryId;
  if (!open.value || !id) { entry.value = null; return; }
  const token = ++requestToken;
  if (!opts.silent) { loading.value = true; entry.value = null; }
  try {
    const result = await api.getProgressEntry(props.plantId, id);
    if (token === requestToken) entry.value = result;
  } finally {
    if (token === requestToken && !opts.silent) loading.value = false;
  }
}
watch([open, () => props.entryId], () => loadEntry());

// "Still processing" state (spec §6.2): a manual refresh only — NO timer/polling. The state also resolves
// on the next navigation via the existing Nuxt-data invalidation.
const refreshing = ref(false);
async function refreshEntry() {
  refreshing.value = true;
  try { await loadEntry({ silent: true }); } finally { refreshing.value = false; }
}

const editLink = computed(() => (props.entryId ? `/plants/${props.plantId}/progress/${props.entryId}/edit` : ''));

function goEdit() {
  if (!props.entryId) return;
  open.value = false;
  return navigateTo(editLink.value);
}
</script>

<template>
  <UiModal v-model="open" :title="$t('progress.entryTitle')">
    <div v-if="loading" class="mp-entry__loading">{{ $t('common.loading') }}</div>
    <div v-else-if="entry" class="mp-entry">
      <div class="mp-entry__head">
        <strong>{{ healthLabel(entry.health) }}</strong>
        <div class="mp-entry__head-right">
          <span class="mp-entry__date">{{ $d(ymdToLocalDate(entry.occurredOn), 'short') }}</span>
          <UiButton size="xs" variant="soft" color="neutral" icon="pencil-square" @click="goEdit">{{ $t('common.edit') }}</UiButton>
        </div>
      </div>

      <div v-if="readyPhotos.length" class="mp-entry__photos">
        <img v-for="p in readyPhotos" :key="p.id" :src="p.imageUrl" :alt="$t('progress.photoAlt')" />
      </div>

      <!-- Still-processing (drive off the rollup, never by scanning the array): a placeholder + a manual
           "Actualizar" that re-reads the entry on demand. RECOVERING already counts toward processingCount. -->
      <div v-if="entry.processingCount > 0" class="mp-entry__processing">
        <p class="mp-entry__processing-text">{{ $t('progress.photosProcessing') }}</p>
        <UiButton size="xs" variant="soft" color="neutral" :loading="refreshing" @click="refreshEntry">
          {{ $t('common.refresh') }}
        </UiButton>
      </div>

      <!-- Failed notice → the edit view (Spec 2 owns per-photo retry/remove; here it is just the notice + link). -->
      <p v-if="entry.failedCount > 0" class="mp-entry__failed">
        {{ $t('progress.photosFailed', { n: entry.failedCount }, entry.failedCount) }}
        <NuxtLink :to="editLink" class="mp-entry__failed-link">{{ $t('progress.editRecord') }}</NuxtLink>
      </p>

      <p v-if="entry.observations" class="mp-entry__obs">{{ entry.observations }}</p>
      <p v-if="entry.sizeCm != null" class="mp-entry__size">{{ $t('progress.sizeValue', { n: entry.sizeCm }) }}</p>

      <div v-if="entry.tags.length" class="mp-entry__chips">
        <UiTagChip v-for="tag in entry.tags" :key="tag.key" :label="tagLabel(tag.key)" :group="tag.group" :active="true" readonly />
      </div>
    </div>
  </UiModal>
</template>

<style scoped>
.mp-entry { display: grid; gap: var(--space-3); }
.mp-entry__loading { color: var(--text-muted); font-family: var(--font-sans); }
.mp-entry__head { display: flex; align-items: center; justify-content: space-between; font-family: var(--font-sans); color: var(--text-strong); }
.mp-entry__head-right { display: flex; align-items: center; gap: var(--space-2); }
.mp-entry__date { font-size: var(--text-xs); color: var(--text-faint); }
.mp-entry__photos { display: flex; flex-wrap: wrap; gap: var(--space-2); }
.mp-entry__photos img { width: 96px; height: 96px; object-fit: cover; border-radius: var(--radius-md); }
.mp-entry__processing { display: flex; align-items: center; gap: var(--space-2); font-family: var(--font-sans); }
.mp-entry__processing-text { margin: 0; font-size: var(--text-sm); color: var(--text-muted); }
.mp-entry__failed { margin: 0; font-family: var(--font-sans); font-size: var(--text-sm); color: var(--text-strong); display: flex; flex-wrap: wrap; gap: var(--space-2); align-items: baseline; }
.mp-entry__failed-link { color: var(--text-link); text-decoration: underline; }
.mp-entry__obs { margin: 0; font-family: var(--font-sans); font-size: var(--text-sm); color: var(--text-strong); }
.mp-entry__size { margin: 0; font-family: var(--font-sans); font-size: var(--text-sm); color: var(--text-muted); }
.mp-entry__chips { display: flex; flex-wrap: wrap; gap: var(--space-2); }
</style>
