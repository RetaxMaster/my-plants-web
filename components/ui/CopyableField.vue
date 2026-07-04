<script setup lang="ts">
// Reusable "show text + copy it" primitive. Given a string, renders a read-only textarea plus a Copy
// button that writes it to the clipboard and flips to a transient "Copied!" label. The single home for
// this behavior — do not inline clipboard logic on pages.
defineOptions({ inheritAttrs: false });

const props = withDefaults(
  defineProps<{
    modelValue: string;
    label?: string;
    rows?: number;
  }>(),
  { rows: 6 },
);

const { t } = useI18n();

const copied = ref(false);
let resetTimer: ReturnType<typeof setTimeout> | undefined;

async function copy() {
  try {
    if (!navigator?.clipboard?.writeText) return; // graceful no-op if the API is unavailable
    await navigator.clipboard.writeText(props.modelValue);
    copied.value = true;
    clearTimeout(resetTimer);
    resetTimer = setTimeout(() => (copied.value = false), 1500);
  } catch {
    // Clipboard denied/unavailable — leave the label unchanged; never throw.
  }
}

onBeforeUnmount(() => clearTimeout(resetTimer));
</script>

<template>
  <div class="mp-copyfield" v-bind="$attrs">
    <label v-if="label" class="mp-copyfield__label">{{ label }}</label>
    <textarea
      class="mp-copyfield__input"
      :value="modelValue"
      :rows="rows"
      readonly
      spellcheck="false"
    />
    <div class="mp-copyfield__actions">
      <UiButton size="sm" variant="soft" icon="clipboard" @click="copy">
        {{ copied ? t('blog.editor.copied') : t('blog.editor.copy') }}
      </UiButton>
    </div>
  </div>
</template>

<style scoped>
.mp-copyfield { display: grid; gap: var(--space-2); }
.mp-copyfield__label { font: var(--weight-semibold) var(--text-sm) var(--font-sans); color: var(--text-strong); }
.mp-copyfield__input {
  width: 100%;
  resize: vertical;
  padding: var(--space-3);
  background: var(--surface-sunken);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  font: var(--text-xs)/1.6 var(--font-mono);
  color: var(--text-body);
}
.mp-copyfield__input:focus-visible { outline: none; box-shadow: var(--shadow-focus); }
.mp-copyfield__actions { display: flex; justify-content: flex-start; }
</style>
