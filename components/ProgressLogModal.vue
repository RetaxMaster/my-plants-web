<script setup lang="ts">
import type { ProgressHealth } from '../types/api.js';

const props = defineProps<{ plantId: string }>();
const emit = defineEmits<{ saved: [] }>();

const open = defineModel<boolean>({ default: false });

const api = useApi();

// Fetched once and cached app-wide by the payload key — never a hard-coded second catalog.
const { data: catalog } = await useAsyncData('progress-catalog', () => api.getProgressCatalog());
const positiveTags = computed(() => (catalog.value ?? []).filter((t) => t.group === 'positive'));
const negativeTags = computed(() => (catalog.value ?? []).filter((t) => t.group === 'negative'));

const HEALTH_OPTIONS: { value: ProgressHealth; label: string; icon: string }[] = [
  { value: 'SICK', label: 'Sick', icon: 'face-frown' },
  { value: 'POOR', label: 'Poor', icon: 'minus-circle' },
  { value: 'GOOD', label: 'Good', icon: 'face-smile' },
  { value: 'EXCELLENT', label: 'Excellent', icon: 'sparkles' },
];

const health = ref<ProgressHealth | null>(null);
const observations = ref('');
const sizeCm = ref<string | number>('');
const selectedTags = ref<string[]>([]);
const files = ref<File[]>([]);
const previews = ref<string[]>([]);
const saving = ref(false);
const error = ref('');

function reset() {
  health.value = null;
  observations.value = '';
  sizeCm.value = '';
  selectedTags.value = [];
  revokePreviews();
  files.value = [];
  previews.value = [];
  error.value = '';
}

function revokePreviews() {
  for (const url of previews.value) URL.revokeObjectURL(url);
}

watch(open, (isOpen) => {
  if (isOpen) {
    reset();
  } else {
    // The modal often stays mounted (plant detail keeps it around), so free the blob previews on
    // close too — otherwise repeated Cancel/Save cycles leak object URLs until the next open/unmount.
    revokePreviews();
    files.value = [];
    previews.value = [];
  }
});
onBeforeUnmount(revokePreviews);

function onFiles(event: Event) {
  const picked = Array.from((event.target as HTMLInputElement).files ?? []);
  revokePreviews();
  files.value = picked.slice(0, 8); // matches the API maxCount
  previews.value = files.value.map((f) => URL.createObjectURL(f));
}

function toggleTag(key: string) {
  const i = selectedTags.value.indexOf(key);
  if (i === -1) selectedTags.value.push(key);
  else selectedTags.value.splice(i, 1);
}

async function save() {
  if (!health.value) { error.value = 'Please select how the plant is doing.'; return; }
  saving.value = true;
  error.value = '';
  try {
    const form = new FormData();
    form.append('health', health.value);
    if (observations.value.trim()) form.append('observations', observations.value.trim());
    if (sizeCm.value != null && `${sizeCm.value}` !== '') form.append('sizeCm', String(sizeCm.value));
    if (selectedTags.value.length) form.append('tags', JSON.stringify(selectedTags.value));
    for (const f of files.value) form.append('photos', f);
    await api.logProgress(props.plantId, form);
    emit('saved');
    open.value = false;
  } catch (e: any) {
    error.value = e?.data?.message ?? 'Could not save progress. Please try again.';
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <UiModal v-model="open" title="Update progress">
    <div class="mp-progress-form">
      <!-- Health (required) -->
      <UiFormGroup label="How is your plant doing?">
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
            <UiAppIcon :name="opt.icon" :size="20" />
            <span>{{ opt.label }}</span>
          </button>
        </div>
      </UiFormGroup>

      <!-- Photos (optional) -->
      <UiFormGroup label="Photos (optional)">
        <input type="file" accept="image/*" multiple class="mp-progress-form__file" @change="onFiles" />
        <div v-if="previews.length" class="mp-progress-form__thumbs">
          <img v-for="(src, i) in previews" :key="i" :src="src" alt="Selected photo preview" />
        </div>
      </UiFormGroup>

      <!-- Observations (optional) -->
      <UiFormGroup label="Observations (optional)">
        <textarea v-model="observations" class="mp-progress-form__textarea" rows="3" maxlength="2000" />
      </UiFormGroup>

      <!-- Size (optional) -->
      <UiFormGroup label="Size in cm (optional)">
        <UiInput v-model.number="sizeCm" type="number" min="1" />
      </UiFormGroup>

      <!-- Tags (optional) -->
      <UiFormGroup label="Worth noting (optional)">
        <div class="mp-progress-form__chips">
          <UiTagChip
            v-for="t in positiveTags"
            :key="t.key"
            :label="t.label"
            group="positive"
            :active="selectedTags.includes(t.key)"
            @toggle="toggleTag(t.key)"
          />
          <UiTagChip
            v-for="t in negativeTags"
            :key="t.key"
            :label="t.label"
            group="negative"
            :active="selectedTags.includes(t.key)"
            @toggle="toggleTag(t.key)"
          />
        </div>
      </UiFormGroup>

      <p v-if="error" class="mp-progress-form__error">{{ error }}</p>
    </div>

    <template #footer>
      <UiButton color="neutral" variant="ghost" @click="open = false">Cancel</UiButton>
      <UiButton color="primary" :loading="saving" @click="save">Save</UiButton>
    </template>
  </UiModal>
</template>

<style scoped>
.mp-progress-form { display: grid; gap: var(--space-4); }

.mp-progress-form__health { display: grid; grid-template-columns: repeat(4, 1fr); gap: var(--space-2); }

.mp-progress-form__health-tile {
  display: flex; flex-direction: column; align-items: center; gap: var(--space-1);
  padding: var(--space-3) var(--space-2);
  font: var(--weight-medium) var(--text-xs) / 1.2 var(--font-sans);
  color: var(--text-muted);
  background: var(--surface-card);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  cursor: pointer;
}
.mp-progress-form__health-tile.is-active {
  color: var(--text-brand);
  border-color: var(--border-brand);
  background: var(--surface-sunken);
}
.mp-progress-form__health-tile:focus-visible { outline: none; box-shadow: var(--shadow-focus); }

.mp-progress-form__file { font-family: var(--font-sans); font-size: var(--text-sm); color: var(--text-muted); }

.mp-progress-form__thumbs { display: flex; flex-wrap: wrap; gap: var(--space-2); margin-top: var(--space-2); }
.mp-progress-form__thumbs img { width: 64px; height: 64px; object-fit: cover; border-radius: var(--radius-md); }

.mp-progress-form__textarea {
  width: 100%;
  font-family: var(--font-sans);
  font-size: var(--text-sm);
  color: var(--text-strong);
  background: var(--surface-card);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  padding: var(--space-2);
  resize: vertical;
  outline: none;
}
.mp-progress-form__textarea:focus { border-color: var(--border-brand); box-shadow: var(--shadow-focus); }

.mp-progress-form__chips { display: flex; flex-wrap: wrap; gap: var(--space-2); }

.mp-progress-form__error { margin: 0; font-size: var(--text-xs); color: var(--red-600); }
</style>
