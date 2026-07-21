<script setup lang="ts">
import type { ClinicalRecordDetail } from '../types/api.js';
import { renderMarkdown } from '../utils/renderMarkdown.js';
import { ymdToLocalDate } from '../utils/localDate.js';

const props = defineProps<{ plantId: string; recordId: string | null }>();
const open = defineModel<boolean>({ default: false });

const api = useApi();
const { t, d } = useI18n();

const record = ref<ClinicalRecordDetail | null>(null);
const loading = ref(false);
const error = ref<'notFound' | 'loadError' | null>(null);

// ⚠️ SECURITY, not convenience. This body is written by an AI AGENT that may have ingested untrusted web
// content while researching, and it renders inside the owner's authenticated session. `renderMarkdown` is
// the ONE sanitized path in this app (marked -> DOMPurify with a closed tag/attr allowlist, unit-tested
// against script tags, onerror attributes, javascript: URLs and .mp-* class grabbing). NEVER introduce a
// second markdown path here, and NEVER reach for v-html directly.
const html = computed(() => (record.value ? renderMarkdown(record.value.body) : ''));

// Request token: opening record A then quickly switching to B must not let A's slower response land.
let requestToken = 0;
async function load() {
  const id = props.recordId;
  if (!id) return;
  const token = ++requestToken;
  loading.value = true;
  error.value = null;
  record.value = null;
  try {
    const r = await api.getClinicalRecord(props.plantId, id);
    if (token === requestToken) record.value = r;
  } catch (e: any) {
    // A cascade-deleted record cannot reach this modal (same plant, same cascade), but a 404 must still
    // read as "this record is gone" rather than rendering an empty document.
    if (token === requestToken) error.value = e?.statusCode === 404 ? 'notFound' : 'loadError';
  } finally {
    if (token === requestToken) loading.value = false;
  }
}

watch(() => [open.value, props.recordId], () => { if (open.value) load(); });
</script>

<template>
  <UiModal v-model="open" :title="t('clinicalRecord.title')">
    <p v-if="record" class="mp-clinical__subtitle">
      {{ t('clinicalRecord.subtitle', { date: d(ymdToLocalDate(record.recordedOn), 'short') }) }}
    </p>
    <p v-if="loading" class="mp-clinical__state">{{ t('clinicalRecord.loading') }}</p>
    <p v-else-if="error" class="mp-clinical__state">{{ t(`clinicalRecord.${error}`) }}</p>
    <UiProse v-else-if="record" :html="html" />
  </UiModal>
</template>

<style scoped>
/* UiModal already applies the shared mobile fix (body flex:1 + min-height:0 + overflow, header/footer
   flex:none, dvh panel), so a long record scrolls correctly inside the panel on a phone. Nothing here
   may reintroduce a fixed height. */
.mp-clinical__subtitle {
  font: var(--text-xs) / 1.4 var(--font-sans);
  color: var(--text-muted);
  margin-bottom: var(--space-3);
}
.mp-clinical__state {
  font: var(--text-sm) / 1.5 var(--font-sans);
  color: var(--text-muted);
}
</style>
