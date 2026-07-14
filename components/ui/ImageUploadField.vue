<script setup lang="ts">
// Direct-upload-with-link control on top of ImageDropzone (max 1). The page injects `upload` (its
// endpoint adapter); this component drives pick -> upload -> progress -> { url } + Copy link. It never
// builds FormData or calls useApi — that glue is the page's job, so cover + media share one UX.
defineOptions({ inheritAttrs: false });

const props = defineProps<{
  upload: (file: File) => Promise<{ url: string }>;
  label?: string;
  hint?: string;
  // For the cover use: show the current image before any new upload.
  currentUrl?: string | null;
}>();

const emit = defineEmits<{ uploaded: [{ url: string }] }>();

const { t } = useI18n();

const files = ref<File[]>([]);
const state = ref<'idle' | 'uploading' | 'done' | 'error'>('idle');
const resultUrl = ref<string | null>(null);
const copied = ref(false);

watch(files, async (list) => {
  const file = list[0];
  if (!file || state.value === 'uploading') return;
  state.value = 'uploading';
  try {
    const { url } = await props.upload(file);
    resultUrl.value = url;
    state.value = 'done';
    emit('uploaded', { url });
  } catch {
    state.value = 'error';
  } finally {
    files.value = []; // clear the picker so the next image can be uploaded
  }
});

const previewUrl = computed(() => resultUrl.value ?? props.currentUrl ?? null);

async function copyLink() {
  if (!resultUrl.value) return;
  await navigator.clipboard.writeText(resultUrl.value);
  copied.value = true;
  window.setTimeout(() => (copied.value = false), 2000);
}
</script>

<template>
  <div class="mp-uploadfield" v-bind="$attrs">
    <div v-if="label" class="mp-uploadfield__label">{{ label }}</div>
    <p v-if="hint" class="mp-uploadfield__hint">{{ hint }}</p>

    <img v-if="previewUrl" :src="previewUrl" :alt="t('blog.media.previewAlt')" class="mp-uploadfield__preview" />

    <UiImageDropzone v-model="files" :max="1" :disabled="state === 'uploading'" />

    <p v-if="state === 'uploading'" class="mp-uploadfield__status">{{ t('blog.media.uploading') }}</p>
    <p v-else-if="state === 'error'" class="mp-uploadfield__status mp-uploadfield__status--error">
      {{ t('blog.media.uploadError') }}
    </p>

    <div v-if="resultUrl" class="mp-uploadfield__result">
      <code class="mp-uploadfield__url">{{ resultUrl }}</code>
      <UiButton size="xs" variant="soft" icon="clipboard" @click="copyLink">
        {{ copied ? t('blog.media.copied') : t('blog.media.copyLink') }}
      </UiButton>
    </div>
  </div>
</template>

<style scoped>
/* `minmax(0, 1fr)`, not the implicit `auto` track.
 *
 * An `auto` grid track is floored by its widest child's MIN-content width, and a grid item's own
 * `min-width` defaults to `auto` — so one unbreakable child can force the whole column wider than the
 * card that holds it. That is exactly what happened here: the result row below carries a `<code>` with
 * the (long, unbreakable) asset URL, and it dragged this single-column track out to ~754px inside a
 * 526px card, which then clipped everything — preview, dropzone and URL alike — because the card is
 * `overflow: hidden`. The `min-width: 0` already on the `<code>` does NOT prevent this: a percentage
 * `flex-basis` (`flex: 1` = `flex-basis: 0%`) is indefinite while intrinsic sizes are being resolved, so
 * the `<code>` still contributes its full max-content width upwards.
 *
 * `minmax(0, 1fr)` lets the track shrink below its content's min-content, which is what a stack of
 * blocks inside a fixed-width card actually wants. It protects every child of this grid, including the
 * ones nobody has added yet. */
.mp-uploadfield { display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--space-3); }
.mp-uploadfield__label { font: var(--weight-semibold) var(--text-sm) var(--font-sans); color: var(--text-strong); }
.mp-uploadfield__hint { margin: 0; font: var(--text-xs) var(--font-sans); color: var(--text-muted); }
.mp-uploadfield__preview {
  width: 100%;
  max-height: 260px;
  object-fit: cover;
  border-radius: var(--radius-lg);
  border: 1px solid var(--border-subtle);
}
.mp-uploadfield__status { margin: 0; font: var(--text-sm) var(--font-sans); color: var(--text-muted); }
.mp-uploadfield__status--error { color: var(--care-poor-text, var(--text-strong)); }
/* `min-width: 0` overrides the grid item's automatic minimum, so this row is allowed to be narrower than
 * the URL it contains — the `<code>` then scrolls inside itself (overflow-x below) instead of pushing the
 * card apart. The track above already permits this; keeping it here means the row stays shrinkable even
 * if it is ever moved into a different container. */
.mp-uploadfield__result { display: flex; align-items: center; gap: var(--space-2); flex-wrap: wrap; min-width: 0; }
.mp-uploadfield__url {
  flex: 1;
  min-width: 0;
  overflow-x: auto;
  padding: var(--space-2) var(--space-3);
  background: var(--surface-sunken);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  font: var(--text-xs) var(--font-mono);
  color: var(--text-body);
  white-space: nowrap;
}
</style>
