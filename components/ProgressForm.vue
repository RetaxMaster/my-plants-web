<script setup lang="ts">
// The ONE register/edit form (fork-prevention — spec §3.1). `progress.vue` (create) and
// `pages/plants/[id]/progress/[entryId]/edit.vue` (edit) both mount this; the only intended difference
// between the two views is how the parent serializes the emitted payload into FormData, the API method
// it calls, and the page-level title/back target. The courtesy pixel check (Spec 1 §6.1) lives here,
// once, so both modes get it for free — this is also the component Spec 3's measure-info modal will
// later mount into (async spec §10 step 4).
import type { ProgressHealth, ProgressEntryDetail, UpdateProgressPayload } from '../types/api.js';
import { readImageSize } from '../composables/useReadImageSize'; // Spec 1 §6.1 — reused, never re-implemented
import { MAX_IMAGE_PIXELS } from '@retaxmaster/my-plants-species-schema/image-limits'; // Spec 1 single-source

const props = defineProps<{
  mode: 'create' | 'edit';
  initial?: ProgressEntryDetail | null; // edit prefills from this
  saving?: boolean;
  saveLabel: string; // the parent owns the phase-aware button copy
  error?: string;
  // The species' growth habit (spec §2.4) — drives the measure modal. Null → generic guide.
  speciesGrowthHabit?: import('@retaxmaster/my-plants-species-schema/plant-profile-constants').GrowthHabit | null;
}>();
const emit = defineEmits<{
  submit: [payload: UpdateProgressPayload];
  cancel: [];        // both modes — the parent owns navigation (goBack)
  delete: [];         // edit only
  retry: [photoId: string]; // edit only — immediate, parent calls the API
}>();

const { t } = useI18n();
const { healthLabel } = useTaskMeta();
const { tagLabel } = useProgressTagMeta();

// Labels come from the shared health.* key set via healthLabel() — no fork of the wording.
const HEALTH_OPTIONS: { value: ProgressHealth; icon: string }[] = [
  { value: 'SICK', icon: 'face-frown' },
  { value: 'POOR', icon: 'minus-circle' },
  { value: 'GOOD', icon: 'face-smile' },
  { value: 'EXCELLENT', icon: 'sparkles' },
];
const SIZE_MIN = 5;
const SIZE_MAX = 100;
const SIZE_STEP = 5;

// Prefill from `initial` in edit mode; blank defaults in create mode.
const health = ref<ProgressHealth | null>(props.initial?.health ?? null);
const occurredOn = ref<string>(props.initial?.occurredOn ?? ''); // create: '' → server defaults to today
const observations = ref(props.initial?.observations ?? '');
const recordSize = ref(props.initial?.sizeCm != null);
const sizeCm = ref<number | null>(props.initial?.sizeCm ?? 45);
const selectedTags = ref<string[]>(props.initial?.tags.map((tg) => tg.key) ?? []);
const files = ref<File[]>([]); // NEW photos to add
const removePhotoIds = ref<string[]>([]); // edit only
const measureInfoOpen = ref(false);

// The catalog for the chips (same async key the create page used). NOT awaited — a client-only form
// never needs to block its own render on the tag catalog; the chips simply populate a beat later.
const api = useApi();
const { data: catalog } = useAsyncData('progress-catalog', () => api.getProgressCatalog());
const positiveTags = computed(() => (catalog.value ?? []).filter((tg) => tg.group === 'positive'));
const negativeTags = computed(() => (catalog.value ?? []).filter((tg) => tg.group === 'negative'));

function toggleTag(key: string) {
  const i = selectedTags.value.indexOf(key);
  if (i === -1) selectedTags.value.push(key);
  else selectedTags.value.splice(i, 1);
}

function goCancel() {
  emit('cancel');
}

// COURTESY pixel check (Spec 1 §6.1) — defined ONCE, here, so create and edit share it. Fails OPEN: an
// unreadable header passes through (the server re-enforces MAX_IMAGE_PIXELS by decoding). Refuses only a
// CONFIDENT over-limit read, with the file name.
const pixelError = ref('');
async function onFilesPicked(picked: File[]) {
  pixelError.value = '';
  const accepted: File[] = [];
  for (const f of picked) {
    const size = await readImageSize(f);
    if (size && size.width * size.height > MAX_IMAGE_PIXELS) {
      pixelError.value = t('progress.photoTooLarge', { name: f.name });
      continue;
    }
    accepted.push(f);
  }
  files.value = accepted;
}

// Existing photos left after pending removals (edit only) — drives the "remaining" count for the
// dropzone cap and the "you've reached the limit" notice.
const remainingExisting = computed(() =>
  (props.initial?.photos ?? []).filter((p) => !removePhotoIds.value.includes(p.id)));
const remainingSlots = computed(() => 8 - remainingExisting.value.length - files.value.length);
// The add-dropzone's own cap on ITS model (new files only): 8 minus existing-after-removals, held
// CONSTANT across additions. Binding the dropzone's max to `remainingSlots` directly would double-count
// `files.length` (it is already netted out of remainingSlots) and lock out legitimate one-at-a-time
// additions after the first file. This is a deliberate correctness fix over the plan's illustrative
// snippet — `remainingSlots` itself is unchanged and still drives the "limit reached" copy.
const addCap = computed(() => (props.mode === 'edit' ? Math.max(0, 8 - remainingExisting.value.length) : 8));

function markRemove(id: string) {
  if (!removePhotoIds.value.includes(id)) removePhotoIds.value.push(id);
}
// Removal is reversible until save: a removed tile dims and shows an "Undo" (Deshacer) affordance.
function undoRemove(id: string) {
  removePhotoIds.value = removePhotoIds.value.filter((x) => x !== id);
}

// Health is required (spec §2). Validate INSIDE the shared form: a submit with no health selected must show
// a visible, localized error (the extraction moved this out of the page, which silently dropped it — a
// code-review regression). Cleared the moment a health tile is chosen.
const healthError = ref('');
watch(health, (v) => { if (v) healthError.value = ''; });

function submit() {
  if (!health.value) { healthError.value = t('progress.errorSelectHealth'); return; }
  emit('submit', {
    health: health.value,
    occurredOn: occurredOn.value,
    observations: observations.value.trim(),
    sizeCm: recordSize.value ? sizeCm.value : null,
    tags: selectedTags.value,
    files: files.value,
    removePhotoIds: removePhotoIds.value,
  });
}

defineExpose({
  health, observations, selectedTags, occurredOn, recordSize, sizeCm, files, pixelError, healthError,
  remainingSlots, submit, markRemove, undoRemove, onFilesPicked,
});
</script>

<template>
  <form class="mp-progress-form" @submit.prevent="submit">
    <UiCard padded class="mp-progress-form__card">
      <!-- Health (required) -->
      <UiFormGroup :label="$t('progress.healthQuestion')" required>
        <div class="mp-progress-form__health">
          <button
            v-for="opt in HEALTH_OPTIONS"
            :key="opt.value"
            type="button"
            class="mp-progress-form__health-tile"
            :class="{ 'is-active': health === opt.value }"
            :aria-pressed="health === opt.value"
            @click="health = opt.value"
          >
            <UiAppIcon :name="opt.icon" :size="22" />
            <span>{{ healthLabel(opt.value) }}</span>
          </button>
        </div>
        <p v-if="healthError" class="mp-progress-form__health-error">{{ healthError }}</p>
      </UiFormGroup>

      <!-- Journal date (backdatable) — shared by create + edit so a wrong date can be corrected (spec §2.4);
           editing it moves the paired CareEvent server-side. Create: empty → the server defaults to today. -->
      <UiFormGroup :label="$t('progress.date')" :hint="$t('progress.dateHint')">
        <UiInput v-model="occurredOn" type="date" />
      </UiFormGroup>

      <!-- Photos (optional) -->
      <UiFormGroup :label="$t('progress.photos')" :hint="$t('progress.photosHint')">
        <!-- Existing photos (edit only) — per Spec 1's photo-state contract (spec §3.2). RECOVERING is
             treated identically to PROCESSING: still-not-ready, no imageUrl, remove disabled (a claimed
             row can't be hard-deleted). -->
        <div v-if="mode === 'edit' && initial" class="mp-progress-form__existing">
          <div
            v-for="p in initial.photos"
            :key="p.id"
            :data-photo="p.id"
            class="mp-progress-form__ptile"
            :class="{ 'is-removed': removePhotoIds.includes(p.id) }"
          >
            <!-- READY: thumbnail + remove -->
            <template v-if="p.status === 'READY'">
              <img :src="p.imageUrl!" :alt="$t('progress.photoAlt')" />
              <button type="button" data-act="remove" :aria-label="$t('common.remove')" @click="markRemove(p.id)">
                <UiAppIcon name="x-mark" :size="14" color="currentColor" />
              </button>
            </template>
            <!-- PENDING: processing placeholder, remove ENABLED (no object exists yet) -->
            <template v-else-if="p.status === 'PENDING'">
              <span class="mp-progress-form__pproc">{{ $t('progress.photoProcessing') }}</span>
              <button type="button" data-act="remove" :aria-label="$t('common.remove')" @click="markRemove(p.id)">
                <UiAppIcon name="x-mark" :size="14" color="currentColor" />
              </button>
            </template>
            <!-- PROCESSING / RECOVERING: processing placeholder, remove DISABLED (claimed, can't hard-delete) -->
            <template v-else-if="p.status === 'PROCESSING' || p.status === 'RECOVERING'">
              <span class="mp-progress-form__pproc">{{ $t('progress.photoProcessing') }}</span>
              <button
                type="button"
                data-act="remove"
                disabled
                :title="$t('progress.photoProcessingWait')"
                :aria-label="$t('progress.photoProcessingWait')"
              >
                <UiAppIcon name="x-mark" :size="14" color="currentColor" />
              </button>
            </template>
            <!-- FAILED + retryable (transient): name + retry + remove -->
            <template v-else-if="p.status === 'FAILED' && p.retryable">
              <span class="mp-progress-form__pfail">{{ p.originalName ?? $t('progress.photoFailedGeneric') }}</span>
              <button type="button" data-act="retry" :aria-label="$t('progress.retryPhoto')" @click="emit('retry', p.id)">
                <UiAppIcon name="arrow-path" :size="14" color="currentColor" />
              </button>
              <button type="button" data-act="remove" :aria-label="$t('common.remove')" @click="markRemove(p.id)">
                <UiAppIcon name="x-mark" :size="14" color="currentColor" />
              </button>
            </template>
            <!-- FAILED + not retryable (permanent, or expired transient): name + remove only -->
            <template v-else-if="p.status === 'FAILED'">
              <span class="mp-progress-form__pfail">{{ p.originalName ?? $t('progress.photoFailedGeneric') }}</span>
              <button type="button" data-act="remove" :aria-label="$t('common.remove')" @click="markRemove(p.id)">
                <UiAppIcon name="x-mark" :size="14" color="currentColor" />
              </button>
            </template>

            <!-- Removal is reversible until save: a dimmed removed tile shows a centered "Undo" (Deshacer)
                 button on top of the scrim; the corner remove/retry controls are hidden while removed. -->
            <button
              v-if="removePhotoIds.includes(p.id)"
              type="button"
              data-act="undo"
              class="mp-progress-form__undo"
              @click="undoRemove(p.id)"
            >
              <UiAppIcon name="arrow-uturn-left" :size="14" color="currentColor" />
              {{ $t('progress.undoRemove') }}
            </button>
          </div>
        </div>
        <p v-if="mode === 'edit' && remainingSlots <= 0" class="mp-progress-form__slots">
          {{ $t('progress.photoLimitReached') }}
        </p>

        <UiImageDropzone :model-value="files" :max="addCap" @update:model-value="onFilesPicked" />
        <p v-if="pixelError" class="mp-progress-form__pixel-error">{{ pixelError }}</p>
      </UiFormGroup>

      <!-- Observations (optional) -->
      <UiFormGroup :label="$t('progress.observations')" :hint="$t('progress.observationsHint')">
        <textarea
          v-model="observations"
          class="mp-progress-form__textarea"
          rows="4"
          maxlength="2000"
          :placeholder="$t('progress.observationsPlaceholder')"
        />
      </UiFormGroup>

      <!-- Size (optional, gated behind a toggle so sizeCm stays optional) -->
      <div class="mp-progress-form__size">
        <div class="mp-progress-form__size-head">
          <span class="mp-progress-form__size-label">
            {{ $t('progress.size') }}
            <button
              type="button"
              class="mp-progress-form__size-info"
              :aria-label="$t('measure.infoAria')"
              @click="measureInfoOpen = true"
            >
              <UiAppIcon name="information-circle" :size="18" />
            </button>
          </span>
          <label class="mp-progress-form__size-switch">
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
        <div class="mp-progress-form__chips">
          <UiTagChip
            v-for="tag in positiveTags"
            :key="tag.key"
            :label="tagLabel(tag.key)"
            group="positive"
            :active="selectedTags.includes(tag.key)"
            @toggle="toggleTag(tag.key)"
          />
          <UiTagChip
            v-for="tag in negativeTags"
            :key="tag.key"
            :label="tagLabel(tag.key)"
            group="negative"
            :active="selectedTags.includes(tag.key)"
            @toggle="toggleTag(tag.key)"
          />
        </div>
      </UiFormGroup>

      <p v-if="error" class="mp-progress-form__error">{{ error }}</p>
    </UiCard>

    <div class="mp-progress-form__actions">
      <UiButton type="button" color="neutral" variant="ghost" @click="goCancel">{{ $t('common.cancel') }}</UiButton>
      <UiButton
        v-if="mode === 'edit'"
        type="button"
        color="neutral"
        variant="ghost"
        icon="trash"
        @click="emit('delete')"
      >
        {{ $t('progress.delete') }}
      </UiButton>
      <UiButton type="submit" color="primary" block :loading="saving" :disabled="saving">{{ saveLabel }}</UiButton>
    </div>
  </form>

  <UiMeasureInfoModal v-model:open="measureInfoOpen" :growth-habit="speciesGrowthHabit ?? null" />
</template>

<style scoped>
.mp-progress-form {
  display: grid;
  gap: var(--space-4);
  max-width: 640px;
}

.mp-progress-form__card {
  display: grid;
  gap: var(--space-5);
}

.mp-progress-form__health {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: var(--space-2);
}

.mp-progress-form__health-tile {
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

.mp-progress-form__health-tile.is-active {
  color: var(--text-brand);
  border-color: var(--border-brand);
  background: var(--surface-sunken);
}

.mp-progress-form__health-tile:focus-visible {
  outline: none;
  box-shadow: var(--shadow-focus);
}

.mp-progress-form__existing {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin-bottom: var(--space-3);
}

.mp-progress-form__ptile {
  position: relative;
  width: 76px;
  height: 76px;
}

.mp-progress-form__ptile img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: var(--radius-md);
  border: 1px solid var(--border-subtle);
}

.mp-progress-form__pproc {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  text-align: center;
  font: var(--text-xs) / 1.2 var(--font-sans);
  color: var(--text-muted);
  background: var(--surface-sunken);
  border: 1px dashed var(--border-default);
  border-radius: var(--radius-md);
}

.mp-progress-form__pfail {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  padding: var(--space-1);
  text-align: center;
  overflow: hidden;
  text-overflow: ellipsis;
  font: var(--text-xs) / 1.2 var(--font-sans);
  color: var(--care-poor);
  background: var(--surface-sunken);
  border: 1px dashed var(--care-poor);
  border-radius: var(--radius-md);
}

/* A removed tile is dimmed by a translucent scrim (NOT tile opacity — that would also fade the Undo button,
   since a child cannot exceed its parent's opacity). The corner remove/retry controls hide while removed;
   the centered Undo button sits above the scrim, fully opaque and clickable. */
.mp-progress-form__ptile.is-removed::before {
  content: '';
  position: absolute;
  inset: 0;
  z-index: 1;
  border-radius: var(--radius-md);
  background: color-mix(in srgb, var(--surface-card) 62%, transparent);
}
.mp-progress-form__ptile.is-removed [data-act='remove'],
.mp-progress-form__ptile.is-removed [data-act='retry'] {
  display: none;
}
.mp-progress-form__undo {
  position: absolute;
  inset: 0;
  z-index: 2;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 0;
  border: none;
  background: transparent;
  font-family: var(--font-sans);
  font-size: var(--text-xs);
  font-weight: 600;
  color: var(--text-strong);
  cursor: pointer;
}
.mp-progress-form__undo:focus-visible {
  outline: none;
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-focus);
}

.mp-progress-form__ptile [data-act='remove'] {
  position: absolute;
  top: -6px;
  right: -6px;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  padding: 0;
  color: var(--text-on-brand);
  background: var(--surface-inverse);
  border: 2px solid var(--surface-card);
  border-radius: 50%;
  cursor: pointer;
}

.mp-progress-form__ptile [data-act='remove']:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.mp-progress-form__ptile [data-act='retry'] {
  position: absolute;
  bottom: -6px;
  right: -6px;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  padding: 0;
  color: var(--text-on-brand);
  background: var(--text-brand);
  border: 2px solid var(--surface-card);
  border-radius: 50%;
  cursor: pointer;
}

.mp-progress-form__slots {
  margin: 0 0 var(--space-3);
  font-size: var(--text-xs);
  color: var(--text-muted);
}

.mp-progress-form__pixel-error {
  margin: var(--space-2) 0 0;
  font-size: var(--text-xs);
  color: var(--care-poor);
}
.mp-progress-form__health-error {
  margin: var(--space-2) 0 0;
  font-size: var(--text-xs);
  color: var(--care-poor);
}

.mp-progress-form__textarea {
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

.mp-progress-form__textarea:focus {
  border-color: var(--border-brand);
  box-shadow: var(--shadow-focus);
}

.mp-progress-form__size {
  display: grid;
  gap: var(--space-3);
}

.mp-progress-form__size-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
}

.mp-progress-form__size-label {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  font-family: var(--font-sans);
  font-size: var(--text-sm);
  font-weight: var(--weight-semibold);
  color: var(--text-strong);
}

.mp-progress-form__size-info {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  flex: none;
  padding: 0;
  border: none;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--text-faint);
  cursor: pointer;
  transition: color var(--dur-fast) var(--ease-out), background var(--dur-fast) var(--ease-out);
}

.mp-progress-form__size-info:hover {
  color: var(--text-muted);
  background: var(--surface-sunken);
}

.mp-progress-form__size-info:focus-visible {
  outline: none;
  box-shadow: var(--shadow-focus);
}

.mp-progress-form__size-switch {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-family: var(--font-sans);
  font-size: var(--text-sm);
  color: var(--text-muted);
  cursor: pointer;
}

.mp-progress-form__chips {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.mp-progress-form__error {
  margin: 0;
  font-size: var(--text-xs);
  color: var(--care-poor);
}

.mp-progress-form__actions {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

/* The block submit grows to fill; Cancel/Delete stay intrinsic on its left. */
.mp-progress-form__actions > :deep(.mp-btn--block) {
  flex: 1;
}
</style>
