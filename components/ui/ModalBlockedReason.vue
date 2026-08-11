<script setup lang="ts">
// WHY A MODAL'S PRIMARY ACTION IS UNAVAILABLE, rendered in the modal's own footer beside the dead button.
//
// ⚠️ ONE IMPLEMENTATION, ON PURPOSE. This markup + CSS lived inline in `SoilReadingModal.vue` (QA UX-2:
// *"a dead green button that explains nothing is a dialog the owner cannot get out of without guessing"*).
// When `PlantCalibrationModal.vue` needed the identical affordance (review finding F1, 2026-08-10), copying
// the paragraph and its twenty lines of footer CSS into a second modal would have been exactly the
// parallel-copies fork the project's own rule forbids — the `:has()` wrap rule and the phone-layout
// override below are the kind of detail that gets fixed in one copy and not the other. Extracted here
// instead; both modals render THIS.
//
// `aria-live` is load-bearing, not decoration: a screen reader must HEAR the reason appear, rather than the
// reason being something only a sighted user notices next to a button that will not press.
defineProps<{ reason?: string }>();
</script>

<template>
  <p v-if="reason" class="mp-modal-blocked" aria-live="polite">{{ reason }}</p>
</template>

<style scoped>
/* The reason shares the modal's `display: flex` footer with Cancel/Save. `auto` on the right margin pushes
   the buttons to the far edge, which is what we want on a wide panel.
   ⚠️ IT NEEDS A FLOOR (QA round 4, 2026-08-10). With no `min-width`, a flex item shrinks to whatever the
   buttons leave over — and these sentences got LONGER in the same fix round that put them here. QA measured
   75 px of column wrapping over NINE lines at 390 px wide, a footer 160 px tall, pushing the form out of
   view. `12ch` is a floor on the text, not a width: it simply stops the column collapsing before the
   wrap-to-own-row rule below takes over. */
.mp-modal-blocked {
  margin: 0 auto 0 0;
  min-width: 12ch;
  font-size: var(--text-sm);
  color: var(--text-faint);
}

/* On a phone the reason takes its OWN ROW, above the buttons, at full width — a sentence is not a third
   button and should not compete with two for one line. `order: -1` puts it first without reordering the
   markup, so the reading order a screen reader gets is unchanged (it is `aria-live` and announces on
   appearance regardless). The footer itself has to be told to wrap: it is `display: flex` with no
   `flex-wrap` in Modal.vue, which is correct for every OTHER modal's footer — none of them puts prose in
   it — so the exception is declared here rather than changed for all of them. */
@media (max-width: 480px) {
  :global(.mp-modal__footer:has(.mp-modal-blocked)) { flex-wrap: wrap; }
  .mp-modal-blocked { order: -1; flex-basis: 100%; min-width: 0; margin: 0; }
}
</style>
