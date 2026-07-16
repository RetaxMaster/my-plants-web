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
}>();
const emit = defineEmits<{
  submit: [payload: UpdateProgressPayload];
  cancel: [];        // both modes — the parent owns navigation (goBack)
  delete: [];         // edit only
  retry: [photoId: string]; // edit only — immediate, parent calls the API
}>();

const { t } = useI18n();
const { healthLabel } = useTaskMeta();

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

function submit() {
  if (!health.value) return; // the parent surfaces the "select health" error; keep the guard here too
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
  health, observations, selectedTags, occurredOn, recordSize, sizeCm, files, pixelError,
  remainingSlots, submit, markRemove, onFilesPicked,
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
      </UiFormGroup>

      <!-- Photos (optional) -->
      <UiFormGroup :label="$t('progress.photos')" :hint="$t('progress.photosHint')">
        <!-- Existing photos (edit only) — Task 7 fills the per-status tiles here. -->
        <div v-if="mode === 'edit' && initial" class="mp-progress-form__existing">
          <div
            v-for="p in initial.photos"
            :key="p.id"
            :data-photo="p.id"
            class="mp-progress-form__ptile"
            :class="{ 'is-removed': removePhotoIds.includes(p.id) }"
          >
            <img v-if="p.status === 'READY'" :src="p.imageUrl!" :alt="$t('progress.photoAlt')" />
            <span v-else class="mp-progress-form__pproc">{{ $t('progress.photoProcessing') }}</span>
            <button
              type="button"
              data-act="remove"
              :aria-label="$t('common.remove')"
              @click="markRemove(p.id)"
            >
              <UiAppIcon name="x-mark" :size="14" color="currentColor" />
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
          <span class="mp-progress-form__size-label">{{ $t('progress.size') }}</span>
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

.mp-progress-form__ptile.is-removed {
  opacity: 0.4;
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
  font-family: var(--font-sans);
  font-size: var(--text-sm);
  font-weight: var(--weight-semibold);
  color: var(--text-strong);
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
