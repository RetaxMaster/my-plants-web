<script setup lang="ts">
import type { UpdateProgressPayload } from '../../../../types/api.js';
import { plantTitle } from '../../../../utils/displayName.js';

const { t, locale } = useI18n();
const route = useRoute();
const api = useApi();
const id = route.params.id as string;

useHead(() => ({ title: t('meta.progress.title') }));
useSeoMeta({ description: () => t('meta.progress.description') });

// Reused so a save here can refresh the detail page's keys by name on return.
const { data: plant } = await useAsyncData(`plant-${id}`, () => api.getPlant(id));

const subtitle = computed(() => (plant.value ? plantTitle(plant.value, locale.value) : undefined));
const saving = ref(false);
const error = ref('');
// Upload percentage, only while photos are actually on the wire. Null when there is nothing to show
// (no photos, or the bytes are all sent and we're waiting on the backend).
const uploadPercent = ref<number | null>(null);

// The save button narrates the three phases it can be in, because they feel very different to a user:
// pushing bytes (a real %), waiting while the server resizes and stores the photos (which can take a
// while and would otherwise look like a frozen idle button), and idle.
const saveLabel = computed(() => {
  if (uploadPercent.value !== null) return t('upload.uploading', { percent: uploadPercent.value });
  if (saving.value) return t('common.saving');
  return t('progress.saveProgress');
});

function goBack() {
  return navigateTo(`/plants/${id}`);
}

async function save(payload: UpdateProgressPayload) {
  if (!payload.health) { error.value = t('progress.errorSelectHealth'); return; }
  saving.value = true;
  error.value = '';
  uploadPercent.value = null;
  try {
    const form = new FormData();
    // Create semantics: append only present/non-empty fields — never send an empty field.
    form.append('health', payload.health);
    if (payload.occurredOn) form.append('occurredOn', payload.occurredOn); // empty → the server defaults to today
    if (payload.observations) form.append('observations', payload.observations);
    if (payload.sizeCm !== null) form.append('sizeCm', String(payload.sizeCm));
    if (payload.tags.length) form.append('tags', JSON.stringify(payload.tags));
    for (const f of payload.files) form.append('photos', f);
    await api.logProgress(id, form, (percent) => {
      // Only meaningful while there are photos to push; at 100% the bytes are out and the backend is
      // still resizing/uploading them, so we drop back to a plain spinner rather than freeze at "100%".
      uploadPercent.value = payload.files.length && percent < 100 ? percent : null;
    });
    // Progress re-anchors (drops off the care rows) and a new entry appears in the timeline — invalidate
    // both keys so the detail page shows fresh data the moment we navigate back, no stale flash.
    await refreshNuxtData([`plant-${id}`, `care-${id}`, `history-${id}`, `photos-${id}`]);
    await navigateTo(`/plants/${id}`);
  } catch (e: any) {
    // Map the API's STABLE error codes to friendly, actionable messages (the raw upstream strings like
    // "Service Unavailable" / "Unprocessable Entity" hide what the user can actually do about it). Never
    // key on a bare status — a 503/422 could also mean a genuinely-down backend. The BFF proxy re-wraps
    // the upstream error as an H3Error, so the API body (with its `code`) can arrive one level deeper
    // (`e.data.data`) as well as at `e.data`; check both depths.
    const code: string | undefined = e?.data?.code ?? e?.data?.data?.code;
    // The photo failed to process on the backend (corrupt/unreadable, unsupported format, or animated).
    const isImageError =
      code === 'image_decode_failed' ||
      code === 'image_unsupported_format' ||
      code === 'image_animated';
    if (code === 'r2_not_configured') {
      error.value = t('progress.errorPhotosUnavailable');
    } else if (isImageError) {
      error.value = t('progress.errorPhotoProcess');
    } else {
      error.value = e?.data?.message ?? t('progress.errorSave');
    }
  } finally {
    saving.value = false;
    uploadPercent.value = null;
  }
}
</script>

<template>
  <div>
    <UiScreenHeader
      :back="$t('progress.back')"
      :title="$t('progress.title')"
      :subtitle="subtitle"
      @back="goBack"
    />
    <ProgressForm
      mode="create"
      :saving="saving"
      :save-label="saveLabel"
      :error="error"
      :species-growth-habit="plant?.speciesGrowthHabit ?? null"
      @submit="save"
      @cancel="goBack"
    />
  </div>
</template>
