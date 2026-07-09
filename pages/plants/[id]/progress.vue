<script setup lang="ts">
import type { ProgressHealth } from '../../../types/api.js';
import { plantTitle } from '../../../utils/displayName.js';

const { t, locale } = useI18n();
const { healthLabel } = useTaskMeta();
const route = useRoute();
const api = useApi();
const id = route.params.id as string;

useHead(() => ({ title: t('meta.progress.title') }));
useSeoMeta({ description: () => t('meta.progress.description') });

// Reuse the same async keys the detail page uses, so a save here can refresh them by key on return.
const { data: plant } = await useAsyncData(`plant-${id}`, () => api.getPlant(id));
// Fetched once and cached app-wide by the payload key — the same catalog the modal used before.
const { data: catalog } = await useAsyncData('progress-catalog', () => api.getProgressCatalog());
const positiveTags = computed(() => (catalog.value ?? []).filter((t) => t.group === 'positive'));
const negativeTags = computed(() => (catalog.value ?? []).filter((t) => t.group === 'negative'));

// Labels are rendered via the shared healthLabel() composable (the single health.* key
// set), so this list carries only the value + icon — no fork of the health wording.
const HEALTH_OPTIONS: { value: ProgressHealth; icon: string }[] = [
  { value: 'SICK', icon: 'face-frown' },
  { value: 'POOR', icon: 'minus-circle' },
  { value: 'GOOD', icon: 'face-smile' },
  { value: 'EXCELLENT', icon: 'sparkles' },
];

// Size bounds — cm. Only sent when the "Record size" toggle is on (preserves the backend's optional
// semantics for sizeCm). The slider seeds at a sensible mid value so the first drag feels natural.
const SIZE_MIN = 5;
const SIZE_MAX = 100;
const SIZE_STEP = 5;

const health = ref<ProgressHealth | null>(null);
const observations = ref('');
const recordSize = ref(false);
const sizeCm = ref<number | null>(45);
const selectedTags = ref<string[]>([]);
const files = ref<File[]>([]);
const saving = ref(false);
const error = ref('');

const subtitle = computed(() => (plant.value ? plantTitle(plant.value, locale.value) : undefined));

function toggleTag(key: string) {
  const i = selectedTags.value.indexOf(key);
  if (i === -1) selectedTags.value.push(key);
  else selectedTags.value.splice(i, 1);
}

function goBack() {
  return navigateTo(`/plants/${id}`);
}

async function save() {
  if (!health.value) { error.value = t('progress.errorSelectHealth'); return; }
  saving.value = true;
  error.value = '';
  try {
    const form = new FormData();
    form.append('health', health.value);
    if (observations.value.trim()) form.append('observations', observations.value.trim());
    if (recordSize.value && sizeCm.value !== null) form.append('sizeCm', String(sizeCm.value));
    if (selectedTags.value.length) form.append('tags', JSON.stringify(selectedTags.value));
    for (const f of files.value) form.append('photos', f);
    await api.logProgress(id, form);
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

    <form class="mp-progress" @submit.prevent="save">
      <UiCard padded class="mp-progress__card">
        <!-- Health (required) -->
        <UiFormGroup :label="$t('progress.healthQuestion')" required>
          <div class="mp-progress__health">
            <button
              v-for="opt in HEALTH_OPTIONS"
              :key="opt.value"
              type="button"
              class="mp-progress__health-tile"
              :class="{ 'is-active': health === opt.value }"
              :aria-pressed="health === opt.value"
              @click="health = opt.value"
            >
              <UiAppIcon :name="opt.icon" :size="22" />
              <span>{{ healthLabel(opt.value) }}</span>
            </button>
          </div>
        </UiFormGroup>

        <!-- Photos (optional) -->
        <UiFormGroup :label="$t('progress.photos')" :hint="$t('progress.photosHint')">
          <UiImageDropzone v-model="files" :max="8" />
        </UiFormGroup>

        <!-- Observations (optional) -->
        <UiFormGroup :label="$t('progress.observations')" :hint="$t('progress.observationsHint')">
          <textarea
            v-model="observations"
            class="mp-progress__textarea"
            rows="4"
            maxlength="2000"
            :placeholder="$t('progress.observationsPlaceholder')"
          />
        </UiFormGroup>

        <!-- Size (optional, gated behind a toggle so sizeCm stays optional) -->
        <div class="mp-progress__size">
          <div class="mp-progress__size-head">
            <span class="mp-progress__size-label">{{ $t('progress.size') }}</span>
            <label class="mp-progress__size-switch">
              <UiSwitch v-model="recordSize" :aria-label="$t('progress.recordSizeAria')" />
              <span>{{ $t('progress.recordSize') }}</span>
            </label>
          </div>
          <UiSlider
            v-if="recordSize"
            v-model="sizeCm"
            :min="SIZE_MIN"
            :max="SIZE_MAX"
            :step="SIZE_STEP"
            :suffix="$t('progress.sizeSuffix')"
            :aria-label="$t('progress.sizeAria')"
          />
        </div>

        <!-- Tags (optional) -->
        <UiFormGroup :label="$t('progress.worthNoting')" :hint="$t('progress.worthNotingHint')">
          <div class="mp-progress__chips">
            <UiTagChip
              v-for="tag in positiveTags"
              :key="tag.key"
              :label="tag.label"
              group="positive"
              :active="selectedTags.includes(tag.key)"
              @toggle="toggleTag(tag.key)"
            />
            <UiTagChip
              v-for="tag in negativeTags"
              :key="tag.key"
              :label="tag.label"
              group="negative"
              :active="selectedTags.includes(tag.key)"
              @toggle="toggleTag(tag.key)"
            />
          </div>
        </UiFormGroup>

        <p v-if="error" class="mp-progress__error">{{ error }}</p>
      </UiCard>

      <div class="mp-progress__actions">
        <UiButton type="button" color="neutral" variant="ghost" @click="goBack">{{ $t('common.cancel') }}</UiButton>
        <UiButton type="submit" color="primary" block :loading="saving" :disabled="saving">{{ $t('progress.saveProgress') }}</UiButton>
      </div>
    </form>
  </div>
</template>

<style scoped>
.mp-progress {
  display: grid;
  gap: var(--space-4);
  max-width: 640px;
}

.mp-progress__card {
  display: grid;
  gap: var(--space-5);
}

.mp-progress__health {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: var(--space-2);
}

.mp-progress__health-tile {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-4) var(--space-2);
  font: var(--weight-medium) var(--text-xs) / 1.2 var(--font-sans);
  color: var(--text-muted);
  background: var(--surface-card);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition:
    color var(--dur-fast) var(--ease-out),
    border-color var(--dur-fast) var(--ease-out),
    background var(--dur-fast) var(--ease-out);
}

.mp-progress__health-tile.is-active {
  color: var(--text-brand);
  border-color: var(--border-brand);
  background: var(--surface-sunken);
}

.mp-progress__health-tile:focus-visible {
  outline: none;
  box-shadow: var(--shadow-focus);
}

.mp-progress__textarea {
  width: 100%;
  font-family: var(--font-sans);
  font-size: var(--text-sm);
  color: var(--text-strong);
  background: var(--surface-card);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  padding: var(--space-3);
  resize: vertical;
  outline: none;
}

.mp-progress__textarea:focus {
  border-color: var(--border-brand);
  box-shadow: var(--shadow-focus);
}

.mp-progress__size {
  display: grid;
  gap: var(--space-3);
}

.mp-progress__size-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
}

.mp-progress__size-label {
  font-family: var(--font-sans);
  font-size: var(--text-sm);
  font-weight: var(--weight-semibold);
  color: var(--text-strong);
}

.mp-progress__size-switch {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-family: var(--font-sans);
  font-size: var(--text-sm);
  color: var(--text-muted);
  cursor: pointer;
}

.mp-progress__chips {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.mp-progress__error {
  margin: 0;
  font-size: var(--text-xs);
  color: var(--care-poor);
}

.mp-progress__actions {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

/* The block submit grows to fill; Cancel stays intrinsic on its left. */
.mp-progress__actions > :deep(.mp-btn--block) {
  flex: 1;
}
</style>
