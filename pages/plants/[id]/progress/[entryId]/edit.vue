<script setup lang="ts">
import type { UpdateProgressPayload } from '../../../../../types/api.js';
import { plantTitle } from '../../../../../utils/displayName.js';

const { t, locale } = useI18n();
const route = useRoute();
const api = useApi();
const id = route.params.id as string;
const entryId = route.params.entryId as string;

useHead(() => ({ title: t('meta.progressEdit.title') }));

const { data: plant } = await useAsyncData(`plant-${id}`, () => api.getPlant(id));
// The entry to edit — its OWN key so a retry can refresh it in place without touching the create keys.
const { data: entry, refresh: refreshEntry } = await useAsyncData(
  `progress-entry-${entryId}`, () => api.getProgressEntry(id, entryId));

const subtitle = computed(() => (plant.value ? plantTitle(plant.value, locale.value) : undefined));
const saving = ref(false);
const error = ref('');
const uploadPercent = ref<number | null>(null);

const saveLabel = computed(() => {
  if (uploadPercent.value !== null) return t('upload.uploading', { percent: uploadPercent.value });
  if (saving.value) return t('common.saving');
  return t('common.saveChanges');
});

function goBack() {
  return navigateTo(`/plants/${id}`);
}

async function onSubmit(payload: UpdateProgressPayload) {
  saving.value = true; error.value = ''; uploadPercent.value = null;
  try {
    const form = new FormData();
    // Edit semantics: ALWAYS send the fields (an empty value CLEARS — spec §2.1). health/occurredOn are
    // required and always present; observations/sizeCm/tags empty = clear.
    form.append('health', payload.health);
    if (payload.occurredOn) form.append('occurredOn', payload.occurredOn);
    form.append('observations', payload.observations); // '' clears
    form.append('sizeCm', payload.sizeCm == null ? '' : String(payload.sizeCm)); // '' clears
    form.append('tags', JSON.stringify(payload.tags)); // [] clears
    form.append('removePhotoIds', JSON.stringify(payload.removePhotoIds));
    for (const f of payload.files) form.append('photos', f);
    await api.updateProgress(id, entryId, form, (percent) => {
      uploadPercent.value = payload.files.length && percent < 100 ? percent : null;
    });
    await refreshNuxtData([`plant-${id}`, `care-${id}`, `history-${id}`, `photos-${id}`]);
    await navigateTo(`/plants/${id}`);
  } catch (e: any) {
    const code: string | undefined = e?.data?.code ?? e?.data?.data?.code;
    error.value =
      code === 'photo_processing' ? t('progress.errorPhotoProcessing')
      : code === 'too_many_photos' ? t('progress.errorTooManyPhotos')
      : e?.data?.message ?? t('progress.errorSave');
  } finally { saving.value = false; uploadPercent.value = null; }
}

// Delete confirmation via the in-app design-system modal (UiModal), NOT the native window.confirm (DS-first).
// @delete opens it; Cancel / Escape / backdrop dismiss it (no delete); only "Delete" commits.
const confirmOpen = ref(false);
function onDelete() { confirmOpen.value = true; }

async function confirmDelete() {
  confirmOpen.value = false;
  saving.value = true; error.value = '';
  try {
    await api.deleteProgress(id, entryId);
    await refreshNuxtData([`plant-${id}`, `care-${id}`, `history-${id}`, `photos-${id}`]);
    await navigateTo(`/plants/${id}`);
  } catch (e: any) {
    const code: string | undefined = e?.data?.code ?? e?.data?.data?.code;
    error.value = code === 'photo_processing' ? t('progress.errorPhotoProcessing') : t('progress.errorSave');
  } finally { saving.value = false; }
}

// Immediate retry (does NOT wait for the PATCH) — refreshes the entry in place.
async function onRetry(photoId: string) {
  try { await api.retryProgressPhoto(id, entryId, photoId); await refreshEntry(); } catch (e: any) {
    const code: string | undefined = e?.data?.code ?? e?.data?.data?.code;
    error.value = code === 'not_retryable' ? t('progress.errorNotRetryable') : t('progress.errorSave');
  }
}
</script>

<template>
  <div>
    <UiScreenHeader :back="$t('progress.back')" :title="$t('progress.editTitle')" :subtitle="subtitle" @back="goBack" />
    <ProgressForm
      v-if="entry"
      mode="edit"
      :initial="entry"
      :saving="saving"
      :save-label="saveLabel"
      :error="error"
      :species-growth-habit="plant?.speciesGrowthHabit ?? null"
      @submit="onSubmit"
      @delete="onDelete"
      @retry="onRetry"
      @cancel="goBack"
    />

    <!-- Delete confirmation via the design-system confirm modal (replaces the native window.confirm). -->
    <UiConfirmModal
      v-model="confirmOpen"
      :title="$t('progress.deleteTitle')"
      :message="$t('progress.deleteConfirm')"
      :confirm-label="$t('progress.delete')"
      confirm-icon="trash"
      @confirm="confirmDelete"
    />
  </div>
</template>
