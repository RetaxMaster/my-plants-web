<script setup lang="ts">
// Reusable image picker with click-to-browse AND drag & drop. Owns nothing but the transient blob
// previews it derives from the File[] it is v-model'd with — the parent keeps the files, this component
// keeps object URLs in lockstep and revokes them carefully (on remove, on unmount, and whenever a file
// leaves the model) so we never leak blobs. Non-image drops are ignored, and the list is clamped to
// `max`.
defineOptions({ inheritAttrs: false });

const props = withDefaults(
  defineProps<{
    // Hard cap on how many files may be selected (also the browse `multiple` limit we enforce).
    max?: number;
    // Passed straight to the <input accept>; drops are filtered by MIME type too.
    accept?: string;
    disabled?: boolean;
  }>(),
  {
    max: 8,
    accept: 'image/*',
    disabled: false,
  },
);

const model = defineModel<File[]>({ default: () => [] });

const inputRef = ref<HTMLInputElement | null>(null);
const dragging = ref(false);

// One object URL per File, reconciled against the model so a removed file's URL is revoked exactly once.
const urls = new Map<File, string>();
const previews = ref<{ file: File; url: string }[]>([]);

function reconcile() {
  const current = model.value ?? [];
  // Revoke URLs for files no longer in the model.
  for (const [file, url] of urls) {
    if (!current.includes(file)) {
      URL.revokeObjectURL(url);
      urls.delete(file);
    }
  }
  // Mint URLs for newly-added files.
  for (const file of current) {
    if (!urls.has(file)) urls.set(file, URL.createObjectURL(file));
  }
  previews.value = current.map((file) => ({ file, url: urls.get(file)! }));
}

// add/remove always assign a NEW array, so this identity watcher fires and previews stay in sync.
watch(model, reconcile);
onMounted(reconcile);
onBeforeUnmount(() => {
  for (const url of urls.values()) URL.revokeObjectURL(url);
  urls.clear();
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
  // Reset so re-picking the same file still fires change.
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
      :aria-label="atLimit ? `Maximum of ${max} photos reached` : 'Add photos'"
      @click="openPicker"
      @dragover.prevent="onDragOver"
      @dragenter.prevent="onDragOver"
      @dragleave.prevent="onDragLeave"
      @drop.prevent="onDrop"
    >
      <UiAppIcon name="camera" :size="22" class="mp-dropzone__icon" />
      <span class="mp-dropzone__title">
        {{ atLimit ? `Photo limit reached (${max})` : 'Drop photos here or click to browse' }}
      </span>
      <span v-if="!atLimit" class="mp-dropzone__hint">Up to {{ max }} images</span>
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
        <img :src="p.url" alt="Selected photo preview" />
        <button
          type="button"
          class="mp-dropzone__remove"
          aria-label="Remove photo"
          @click="removeAt(i)"
        >
          <UiAppIcon name="x-mark" :size="14" color="currentColor" />
        </button>
      </li>
    </ul>
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
</style>
