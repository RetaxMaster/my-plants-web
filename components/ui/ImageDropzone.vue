<script setup lang="ts">
// Reusable image picker with click-to-browse AND drag & drop. Owns the transient blob previews it derives
// from the File[] it is v-model'd with, and revokes them carefully so we never leak blobs. When `compress`
// is on, it ALSO runs each file through the shared useImageCompression seam (spec §3b): it publishes the
// compressed results via `v-model:results`, and renders a per-photo HD (original) toggle + an honest
// savings badge. `compress` defaults OFF so single-file callers (cover photo) are unaffected.
import { useImageCompression, savingsOf, type CompressedUpload } from '../../composables/useImageCompression';
import { formatBytes } from '../../utils/upload';

defineOptions({ inheritAttrs: false });

const props = withDefaults(
  defineProps<{
    max?: number;
    accept?: string;
    disabled?: boolean;
    compress?: boolean;
  }>(),
  { max: 8, accept: 'image/*', disabled: false, compress: false },
);

const model = defineModel<File[]>({ default: () => [] });
// Compressed results, aligned 1:1 with `model` order (compress mode only). Parent appends these to FormData.
const results = defineModel<CompressedUpload[]>('results', { default: () => [] });

const { t } = useI18n();
// Named apart from the `compress` prop: a local binding of the same name would shadow the prop inside the
// template (Vue auto-exposes each declared prop under its own name there), turning `v-if="compress"` into a
// check against this always-truthy function instead of the boolean flag.
const { compress: compressImage } = useImageCompression();
const inputRef = ref<HTMLInputElement | null>(null);
const dragging = ref(false);

// One object URL per File, reconciled against the model so a removed file's URL is revoked exactly once.
const urls = new Map<File, string>();

// Per-file compression bookkeeping (compress mode). Keyed by File identity, exactly like `urls`.
interface Slot { hd: boolean; result: CompressedUpload | null; pending: boolean; gen: number }
const slots = new Map<File, Slot>();

// The reactive view the template renders: url + (in compress mode) the live compression state per file.
interface Preview { file: File; url: string; hd: boolean; result: CompressedUpload | null; pending: boolean }
const previews = ref<Preview[]>([]);

function rebuild() {
  const current = model.value ?? [];
  previews.value = current.map((file) => {
    const slot = slots.get(file);
    return { file, url: urls.get(file)!, hd: slot?.hd ?? false, result: slot?.result ?? null, pending: slot?.pending ?? false };
  });
  if (props.compress) {
    // Until a file finishes compressing, fall back to the raw file so a fast submit never loses a photo.
    results.value = current.map((file) => {
      const r = slots.get(file)?.result;
      if (r) return r;
      return { blob: file, filename: file.name, mimeType: file.type, originalBytes: file.size, sentBytes: file.size, wasOptimised: false };
    });
  }
}

// Per-slot generation counter: a fast HD-toggle can start a SECOND compression of the same slot while the
// first is still in flight. Both share one `slot`, so the identity check below is not enough — the slower
// (wrong-HD) result could resolve last and clobber the newer one. Bump a generation on each start and accept
// a result only if its generation is still current.
async function compressFile(file: File) {
  const slot = slots.get(file);
  if (!slot) return;
  const gen = ++slot.gen;
  slot.pending = true;
  rebuild();
  const result = await compressImage(file, { hd: slot.hd });
  if (slots.get(file) !== slot || slot.gen !== gen) return; // removed OR superseded by a newer compression
  slot.result = result;
  slot.pending = false;
  rebuild();
}

function reconcile() {
  const current = model.value ?? [];
  // Revoke URLs for files no longer in the model.
  for (const [file, url] of urls) {
    if (!current.includes(file)) { URL.revokeObjectURL(url); urls.delete(file); }
  }
  // Mint URLs for newly-added files.
  for (const file of current) {
    if (!urls.has(file)) urls.set(file, URL.createObjectURL(file));
  }
  if (props.compress) {
    for (const [file] of slots) if (!current.includes(file)) slots.delete(file);
    for (const file of current) {
      if (!slots.has(file)) { slots.set(file, { hd: false, result: null, pending: true, gen: 0 }); void compressFile(file); }
    }
  }
  rebuild();
}

function toggleHd(file: File) {
  const slot = slots.get(file);
  if (!slot) return;
  slot.hd = !slot.hd;
  // Drop the previous-generation result so a submit fired DURING the re-compression never sends the stale
  // wrong-HD blob. With result cleared, `rebuild()` falls back to the raw file (full quality) — the
  // fail-open floor, which is never a quality regression against the just-requested HD state. `compressFile`
  // bumps the generation and repopulates the result for the newly-selected HD when it resolves.
  slot.result = null;
  void compressFile(file);
}

// Total bytes saved across the batch (compress mode) — 0 contributions from non-optimised photos.
const batchSaved = computed(() =>
  previews.value.reduce((sum, p) => sum + (p.result ? savingsOf(p.result) : 0), 0));

watch(model, reconcile);
onMounted(reconcile);
onBeforeUnmount(() => {
  for (const url of urls.values()) URL.revokeObjectURL(url);
  urls.clear();
  slots.clear();
});

const atLimit = computed(() => (model.value?.length ?? 0) >= props.max);

function addFiles(incoming: FileList | File[]) {
  if (props.disabled) return;
  const images = Array.from(incoming).filter((f) => f.type.startsWith('image/'));
  if (!images.length) return;
  const room = props.max - (model.value?.length ?? 0);
  if (room <= 0) return;
  model.value = [...(model.value ?? []), ...images.slice(0, room)];
}

function removeAt(index: number) {
  const next = [...(model.value ?? [])];
  next.splice(index, 1);
  model.value = next;
}

function openPicker() {
  if (props.disabled || atLimit.value) return;
  inputRef.value?.click();
}

function onPicked(event: Event) {
  const input = event.target as HTMLInputElement;
  if (input.files) addFiles(input.files);
  input.value = '';
}

function onDrop(event: DragEvent) {
  dragging.value = false;
  if (event.dataTransfer?.files) addFiles(event.dataTransfer.files);
}

function onDragOver() {
  if (!props.disabled && !atLimit.value) dragging.value = true;
}

function onDragLeave() {
  dragging.value = false;
}
</script>

<template>
  <div class="mp-dropzone" v-bind="$attrs">
    <button
      type="button"
      class="mp-dropzone__drop"
      :class="{ 'is-dragging': dragging, 'is-disabled': disabled || atLimit }"
      :disabled="disabled || atLimit"
      :aria-label="atLimit ? t('dropzone.limitReachedAria', { max }) : t('dropzone.addPhotos')"
      @click="openPicker"
      @dragover.prevent="onDragOver"
      @dragenter.prevent="onDragOver"
      @dragleave.prevent="onDragLeave"
      @drop.prevent="onDrop"
    >
      <UiAppIcon name="camera" :size="22" class="mp-dropzone__icon" />
      <span class="mp-dropzone__title">
        {{ atLimit ? t('dropzone.limitReached', { max }) : t('dropzone.dropOrBrowse') }}
      </span>
      <span v-if="!atLimit" class="mp-dropzone__hint">{{ t('dropzone.upTo', { max }, max) }}</span>
    </button>

    <input
      ref="inputRef"
      class="mp-dropzone__input"
      type="file"
      :accept="accept"
      multiple
      @change="onPicked"
    />

    <ul v-if="previews.length" class="mp-dropzone__thumbs">
      <li v-for="(p, i) in previews" :key="p.url" class="mp-dropzone__thumb">
        <img :src="p.url" :alt="t('dropzone.photoPreviewAlt')" />
        <button
          type="button"
          class="mp-dropzone__remove"
          :aria-label="t('dropzone.removePhoto')"
          @click="removeAt(i)"
        >
          <UiAppIcon name="x-mark" :size="14" color="currentColor" />
        </button>

        <!-- Compress mode: per-photo HD (original) toggle + honest savings badge. -->
        <template v-if="compress">
          <button
            type="button"
            class="mp-dropzone__hd"
            :class="{ 'is-on': p.hd }"
            :aria-pressed="p.hd"
            :aria-label="t('dropzone.hdAria', { name: p.file.name })"
            :title="t('dropzone.hdHint')"
            @click="toggleHd(p.file)"
          >
            {{ t('dropzone.hd') }}
          </button>
          <span class="mp-dropzone__savings">
            <template v-if="p.pending">…</template>
            <template v-else-if="p.result && p.result.wasOptimised">
              {{ t('dropzone.saved', { size: formatBytes(savingsOf(p.result)) }) }}
            </template>
            <template v-else>{{ t('dropzone.original') }}</template>
          </span>
        </template>
      </li>
    </ul>

    <p v-if="compress && batchSaved > 0" class="mp-dropzone__batch">
      {{ t('dropzone.savedBatch', { size: formatBytes(batchSaved) }) }}
    </p>
  </div>
</template>

<style scoped>
.mp-dropzone {
  display: grid;
  gap: var(--space-3);
}

.mp-dropzone__drop {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-1);
  width: 100%;
  padding: var(--space-6) var(--space-4);
  text-align: center;
  color: var(--text-muted);
  background: var(--surface-card);
  border: 1.5px dashed var(--border-default);
  border-radius: var(--radius-lg);
  cursor: pointer;
  transition:
    background var(--dur-fast) var(--ease-out),
    border-color var(--dur-fast) var(--ease-out),
    color var(--dur-fast) var(--ease-out);
}

.mp-dropzone__drop.is-dragging {
  color: var(--text-brand);
  border-color: var(--border-brand);
  background: var(--surface-sunken);
}

.mp-dropzone__drop:hover:not(.is-disabled) {
  border-color: var(--border-strong);
}

.mp-dropzone__drop:focus-visible {
  outline: none;
  box-shadow: var(--shadow-focus);
}

.mp-dropzone__drop.is-disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

.mp-dropzone__icon {
  color: var(--text-faint);
}

.mp-dropzone__drop.is-dragging .mp-dropzone__icon {
  color: var(--text-brand);
}

.mp-dropzone__title {
  font: var(--weight-medium) var(--text-sm) / 1.3 var(--font-sans);
}

.mp-dropzone__hint {
  font: var(--text-xs) / 1.2 var(--font-sans);
  color: var(--text-faint);
}

.mp-dropzone__input {
  display: none;
}

.mp-dropzone__thumbs {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin: 0;
  padding: 0;
  list-style: none;
}

.mp-dropzone__thumb {
  position: relative;
  width: 76px;
  height: 76px;
}

.mp-dropzone__thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: var(--radius-md);
  border: 1px solid var(--border-subtle);
}

.mp-dropzone__remove {
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
  transition: filter var(--dur-fast) var(--ease-out);
}

.mp-dropzone__remove:hover {
  filter: brightness(1.15);
}

.mp-dropzone__remove:focus-visible {
  outline: none;
  box-shadow: var(--shadow-focus);
}

.mp-dropzone__hd {
  position: absolute;
  bottom: -6px;
  left: -6px;
  display: flex;
  align-items: center;
  justify-content: center;
  height: 20px;
  padding: 0 6px;
  font: var(--weight-semibold) 10px / 1 var(--font-sans);
  letter-spacing: 0.02em;
  color: var(--text-muted);
  background: var(--surface-card);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition:
    color var(--dur-fast) var(--ease-out),
    border-color var(--dur-fast) var(--ease-out),
    background var(--dur-fast) var(--ease-out);
}

.mp-dropzone__hd.is-on {
  color: var(--text-on-brand);
  background: var(--text-brand);
  border-color: var(--border-brand);
}

.mp-dropzone__hd:focus-visible {
  outline: none;
  box-shadow: var(--shadow-focus);
}

.mp-dropzone__savings {
  display: block;
  margin-top: var(--space-1);
  text-align: center;
  font: var(--text-xs) / 1.2 var(--font-sans);
  color: var(--text-faint);
}

.mp-dropzone__batch {
  margin: var(--space-1) 0 0;
  font: var(--weight-medium) var(--text-xs) / 1.3 var(--font-sans);
  color: var(--care-good, var(--text-brand));
}
</style>
