<script setup lang="ts">
// Shared chrome for a clickable list row: an icon, a slotted label, a trailing date and a chevron —
// rendered as a real <button> so focus/keyboard/accessible-name all come from native semantics, never
// re-implemented. Extracted out of HistoryTimeline.vue, where the 'progress' and 'clinical' branches had
// grown byte-identical wrappers around two different icons/labels/events — exactly the parallel-copy
// pattern this project treats as its highest-yield bug class. A third clickable row (the gardener log)
// is expected next, so this is the ONE place that chrome lives from now on.
//
// The classes below (`mp-history__row` etc.) are intentionally left as-is rather than renamed: they are
// styled by the CONSUMER (HistoryTimeline.vue keeps the CSS, deliberately unscoped there — see its
// <style> block), not by this component, so the non-extracted 'action' row in that file keeps rendering
// pixel-identical without any duplicated CSS. This component owns structure only, never presentation.
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
