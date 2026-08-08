<script setup lang="ts">
import type { ComputedRef } from 'vue';
// Generic pill-group segmented control — the ONE implementation behind ES/EN language switching, the
// Write/Split/Read editor mode, and (refactored) LocaleToggle. `size="sm"` reproduces LocaleToggle's
// compact look; the default `md` matches the design bundle's `.mp-seg`.
defineOptions({ inheritAttrs: false });

const props = withDefaults(
  defineProps<{
    options: { key: string; label: string }[];
    ariaLabel?: string;
    size?: 'sm' | 'md';
    disabled?: boolean;
  }>(),
  { size: 'md', disabled: false },
);

const model = defineModel<string>({ required: true });

// FormGroup's two ids. This component was the ONLY one of the five controls a FormGroup wraps
// (Input/SelectField/Switch/Slider/SegmentedControl) that injected neither — so from commit 91f6610, which
// swapped a `<select>` for a SegmentedControl on /plants/new, the visible "Fresh substrate?" label pointed
// its `for` at an id nothing carried: clicking it focused nothing and a screen reader announced three bare
// buttons with no idea what question they answered. Fixed HERE and not at the call site because
// RepotDoneForm.vue has the identical gap — one component, both surfaces.
const fieldId = inject<string | undefined>('mpFieldId', undefined);
const fieldLabelId = inject<ComputedRef<string | undefined> | undefined>('mpFieldLabelId', undefined);

// WHY the group is named one way and the `for` target chosen another — all four facts below were measured
// in real Chromium (CDP `Accessibility.getPartialAXTree`), not reasoned from the spec:
//  1. `<label for>` associates ONLY with a LABELABLE element. Pointing it at the `role="group"` div makes
//     the id EXIST but creates no association at all — the label click leaves focus on `<body>`. So the
//     `for` target must be a BUTTON, the only labelable thing in here.
//  2. Clicking the label then really does focus AND activate that button. Harmless by construction: the
//     target is the ALREADY-SELECTED segment and `choose()` returns early when the key equals the model,
//     so the label can never change the owner's answer.
//  3. Chrome DOES take a button's accessible name from an associated `<label for>` — the targeted segment
//     was announced as "Fresh substrate?" instead of "Fresh". `aria-label` (and ONLY `aria-label` — a
//     self-referencing `aria-labelledby` was measured and does NOT win) restores it. It carries the
//     segment's own visible text verbatim, so WCAG 2.5.3 "Label in Name" still holds for voice control.
//  4. The GROUP itself is named by `aria-labelledby` back at the FormGroup label, which is the ARIA way to
//     name a `role="group"`; an explicit `ariaLabel` prop still wins, so LocaleToggle and the blog editor
//     (no FormGroup ancestor) are untouched.
const labelledKey = computed(() => {
  if (!props.options.length) return undefined;
  // Falls back to the first option when the model matches nothing, so the `for` target never dangles on a
  // control whose value is empty or stale.
  return props.options.some((o) => o.key === model.value) ? model.value : props.options[0]!.key;
});
const groupLabelledBy = computed(() => (props.ariaLabel ? undefined : fieldLabelId?.value));

function choose(key: string) {
  if (props.disabled) return;
  if (key !== model.value) model.value = key;
}
</script>

<template>
  <div
    class="mp-seg"
    :class="`mp-seg--${size}`"
    role="group"
    :aria-label="ariaLabel"
    :aria-labelledby="groupLabelledBy"
    v-bind="$attrs"
  >
    <button
      v-for="o in options"
      :key="o.key"
      type="button"
      :id="fieldId && o.key === labelledKey ? fieldId : undefined"
      :aria-label="fieldId && o.key === labelledKey ? o.label : undefined"
      :disabled="disabled"
      :class="{ on: o.key === model }"
      :aria-pressed="o.key === model"
      @click="choose(o.key)"
    >
      {{ o.label }}
    </button>
  </div>
</template>

<style scoped>
.mp-seg {
  display: inline-flex;
  gap: 2px;
  background: var(--surface-sunken);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-pill);
  padding: 3px;
}
.mp-seg button {
  border: none;
  background: transparent;
  cursor: pointer;
  border-radius: var(--radius-pill);
  color: var(--text-muted);
  font: var(--weight-semibold) var(--text-sm) var(--font-sans);
  transition: background var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out);
}
.mp-seg--md button { padding: 6px 14px; }
.mp-seg--sm { padding: 2px; }
.mp-seg--sm button { min-width: 34px; padding: 3px 10px; font-size: var(--text-xs); }
.mp-seg button.on {
  background: var(--surface-card);
  color: var(--text-strong);
  box-shadow: var(--shadow-sm);
}
.mp-seg--sm button.on { box-shadow: var(--shadow-xs); }
.mp-seg button:focus-visible {
  outline: none;
  box-shadow: var(--shadow-focus);
}
.mp-seg button:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}
</style>
