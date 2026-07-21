<script setup lang="ts">
// Shared chrome for a clickable list row: an icon, a slotted label, a trailing date and a chevron —
// rendered as a real <button> so focus/keyboard/accessible-name all come from native semantics, never
// re-implemented. Extracted out of HistoryTimeline.vue, where the 'progress' and 'clinical' branches had
// grown byte-identical wrappers around two different icons/labels/events — exactly the parallel-copy
// pattern this project treats as its highest-yield bug class. A third clickable row (the gardener log)
// is expected next, so this is the ONE place that chrome lives from now on.
//
// The classes below (`mp-history__row` etc.) are intentionally left as-is rather than renamed — the
// name predates this extraction and HistoryTimeline.vue's non-extracted 'action' row still uses the
// same names on its own inline markup, so the DOM/class contract stays identical either way. But the
// PRESENTATION is this component's own: a reusable component ships its own default look rather than
// depending on whichever parent happens to render it to also define matching CSS for it. See this
// file's own <style scoped> below.
defineProps<{
  /** Icon name resolved by UiAppIcon (heroicons set). */
  icon: string;
  /** Pre-formatted relative date label ("today", "3 days ago", …) — date math stays in the consumer. */
  dateLabel: string;
}>();

defineEmits<{ click: [] }>();
</script>

<template>
  <button type="button" class="mp-history__row mp-history__row--link" @click="$emit('click')">
    <UiAppIcon :name="icon" :size="18" class="mp-history__icon" />
    <span class="mp-history__text"><slot /></span>
    <span class="mp-history__date">{{ dateLabel }}</span>
    <UiAppIcon name="chevron-right" :size="16" color="var(--text-faint)" />
  </button>
</template>

<style scoped>
/* This component's complete default look — self-contained, not dependent on the consumer defining
 * matching CSS. Nothing here animates a blurred/backdrop-filtered or mix-blend-mode'd element, and
 * nothing animates a layout/paint property in a loop: `:hover`/`:focus-visible` only ever swap a
 * `color`/`box-shadow` value on a discrete user interaction, never a running animation. */
.mp-history__row {
  display: flex; align-items: center; gap: var(--space-2);
  width: 100%; padding: var(--space-3) 0; text-align: left;
  background: transparent; border: none; font-family: var(--font-sans);
}
.mp-history__row--link { cursor: pointer; }
.mp-history__row--link:hover .mp-history__text { color: var(--text-brand); }
.mp-history__row--link:focus-visible { outline: none; box-shadow: var(--shadow-focus); border-radius: var(--radius-md); }

.mp-history__icon { color: var(--text-muted); flex: none; }
.mp-history__text { flex: 1; min-width: 0; font-size: var(--text-sm); color: var(--text-strong); }
.mp-history__date { font-size: var(--text-xs); color: var(--text-faint); white-space: nowrap; }
</style>
