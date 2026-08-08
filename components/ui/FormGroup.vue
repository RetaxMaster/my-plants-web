<script setup lang="ts">
defineOptions({ inheritAttrs: false });

const props = withDefaults(
  defineProps<{
    label?: string;
    hint?: string;
    error?: string;
    required?: boolean;
  }>(),
  {
    required: false,
  },
);

// Generate one stable id (SSR-safe via useId) and both (a) target it from our
// <label for> and (b) provide it so the slotted control (Input/SelectField/Switch)
// injects it as its own id. This wires the visual label to the real control, so
// clicking the label focuses/toggles it and screen readers announce them together.
const fieldId = useId();
provide('mpFieldId', fieldId);

// The label's OWN id, provided as a second, separate contract — needed by a slotted control that is a
// GROUP rather than a single form control (SegmentedControl). `<label for>` only associates with a
// LABELABLE element (button/input/select/textarea/meter/progress/output), so a `role="group"` wrapper can
// never take the `for` and can never be named by it; the ARIA way to name a group is `aria-labelledby`
// pointing back at this label. Provided as a COMPUTED, not a bare string, because the label element is
// `v-if="label"` — with no label there is no element to reference, and handing a group a dangling
// `aria-labelledby` is the same defect class (a reference whose target does not exist) this whole change
// exists to close.
const fieldLabelId = computed(() => (props.label ? `${fieldId}-label` : undefined));
provide('mpFieldLabelId', fieldLabelId);
</script>

<template>
  <div class="mp-form-group" v-bind="$attrs">
    <label v-if="label" :id="fieldLabelId" :for="fieldId" class="mp-form-group__label">
      {{ label }}
      <span v-if="required" class="mp-form-group__required">*</span>
    </label>
    <slot />
    <span v-if="hint && !error" class="mp-form-group__hint">{{ hint }}</span>
    <span v-if="error" class="mp-form-group__error">{{ error }}</span>
  </div>
</template>

<style scoped>
.mp-form-group {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.mp-form-group__label {
  display: flex;
  gap: 3px;
  font-family: var(--font-sans);
  font-size: var(--text-sm);
  font-weight: var(--weight-semibold);
  color: var(--text-strong);
}

.mp-form-group__required {
  color: var(--red-500);
}

.mp-form-group__hint {
  font-family: var(--font-sans);
  font-size: var(--text-xs);
  color: var(--text-muted);
}

.mp-form-group__error {
  font-family: var(--font-sans);
  font-size: var(--text-xs);
  color: var(--care-poor);
}
</style>
