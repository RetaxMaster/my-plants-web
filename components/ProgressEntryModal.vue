<script setup lang="ts">
import type { ProgressEntryDetail } from '../types/api.js';
import { ymdToLocalDate } from '../utils/localDate.js';

const props = defineProps<{ plantId: string; entryId: string | null }>();
const open = defineModel<boolean>({ default: false });

const api = useApi();
const { healthLabel } = useTaskMeta();
const entry = ref<ProgressEntryDetail | null>(null);
const loading = ref(false);

// Request token: opening entry A then quickly switching to entry B must not let A's slower response
// overwrite B. Each fetch stamps a token; a response only lands if it is still the latest request.
let requestToken = 0;
watch([open, () => props.entryId], async ([isOpen, id]) => {
  if (!isOpen || !id) { entry.value = null; return; }
  const token = ++requestToken;
  loading.value = true;
  entry.value = null;
  try {
    const result = await api.getProgressEntry(props.plantId, id);
    if (token === requestToken) entry.value = result;
  } finally {
    if (token === requestToken) loading.value = false;
  }
});
</script>

<template>
  <UiModal v-model="open" :title="$t('progress.entryTitle')">
    <div v-if="loading" class="mp-entry__loading">{{ $t('common.loading') }}</div>
    <div v-else-if="entry" class="mp-entry">
      <div class="mp-entry__head">
        <strong>{{ healthLabel(entry.health) }}</strong>
        <span class="mp-entry__date">{{ $d(ymdToLocalDate(entry.occurredOn), 'short') }}</span>
      </div>

      <div v-if="entry.photos.length" class="mp-entry__photos">
        <img v-for="p in entry.photos" :key="p.id" :src="p.imageUrl" :alt="$t('progress.photoAlt')" />
      </div>

      <p v-if="entry.observations" class="mp-entry__obs">{{ entry.observations }}</p>
      <p v-if="entry.sizeCm != null" class="mp-entry__size">{{ $t('progress.sizeValue', { n: entry.sizeCm }) }}</p>

      <div v-if="entry.tags.length" class="mp-entry__chips">
        <UiTagChip v-for="t in entry.tags" :key="t.key" :label="t.label" :group="t.group" :active="true" readonly />
      </div>
    </div>
  </UiModal>
</template>

<style scoped>
.mp-entry { display: grid; gap: var(--space-3); }
.mp-entry__loading { color: var(--text-muted); font-family: var(--font-sans); }
.mp-entry__head { display: flex; align-items: baseline; justify-content: space-between; font-family: var(--font-sans); color: var(--text-strong); }
.mp-entry__date { font-size: var(--text-xs); color: var(--text-faint); }
.mp-entry__photos { display: flex; flex-wrap: wrap; gap: var(--space-2); }
.mp-entry__photos img { width: 96px; height: 96px; object-fit: cover; border-radius: var(--radius-md); }
.mp-entry__obs { margin: 0; font-family: var(--font-sans); font-size: var(--text-sm); color: var(--text-strong); }
.mp-entry__size { margin: 0; font-family: var(--font-sans); font-size: var(--text-sm); color: var(--text-muted); }
.mp-entry__chips { display: flex; flex-wrap: wrap; gap: var(--space-2); }
</style>
