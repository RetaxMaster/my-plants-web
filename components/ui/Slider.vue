<script setup lang="ts">
// Reusable, themeable range slider. A native <input type="range"> underneath (keyboard-accessible and
// screen-reader-friendly for free), styled entirely from design tokens so it matches light/dark. The
// filled portion is painted with a gradient driven by the current value, so there is no JS animation
// loop — just a static background that updates on input (respects the performance invariant).
import AppIcon from './AppIcon.vue';

defineOptions({ inheritAttrs: false });

const props = withDefaults(
  defineProps<{
    min?: number;
    max?: number;
    step?: number;
    // Optional unit shown next to the value badge (e.g. "cm" → "45 cm").
    suffix?: string;
    // Show the live value badge on the right. On by default.
    showValue?: boolean;
    disabled?: boolean;
    // Offer a clear (×) control that returns the model to `null` (an unset optional field).
    clearable?: boolean;
    // Badge text while the model is `null` (e.g. "Not set"). Falls back to an em dash.
    placeholder?: string;
    // Accessible name for the clear control.
    clearLabel?: string;
  }>(),
  {
    min: 0,
    max: 100,
    step: 1,
    showValue: true,
    disabled: false,
    clearable: false,
  },
);

// `null` means "unset" — an optional field the user has not filled in. The track then reads empty and
// the badge shows `placeholder`; the first drag commits a real number.
const model = defineModel<number | null>({ default: null });

// A FormGroup may hand us an id so its <label for> focuses this control.
const fieldId = inject<string | undefined>('mpFieldId', undefined);

// 0–100% position of the current value, used to paint the filled track. Unset reads as empty.
const percent = computed(() => {
  if (model.value === null) return 0;
  const span = props.max - props.min;
  if (span <= 0) return 0;
  const clamped = Math.min(props.max, Math.max(props.min, model.value));
  return ((clamped - props.min) / span) * 100;
});

const valueText = computed(() => {
  if (model.value === null) return props.placeholder ?? '—';
  return props.suffix ? `${model.value} ${props.suffix}` : `${model.value}`;
});

const showClear = computed(() => props.clearable && model.value !== null && !props.disabled);

function onInput(event: Event) {
  model.value = Number((event.target as HTMLInputElement).value);
}

function onClear() {
  model.value = null;
}
</script>

<template>
  <div class="mp-slider" v-bind="$attrs">
    <input
      :id="fieldId"
      class="mp-slider__input"
      type="range"
      :min="min"
      :max="max"
      :step="step"
      :value="model ?? min"
      :disabled="disabled"
      :aria-valuetext="valueText"
      :style="{ '--mp-slider-fill': percent + '%' }"
      @input="onInput"
    />
    <span
      v-if="showValue"
      class="mp-slider__value"
      :class="{ 'mp-slider__value--unset': model === null }"
    >{{ valueText }}</span>
    <button
      v-if="showClear"
      type="button"
      class="mp-slider__clear"
      :aria-label="clearLabel"
      :title="clearLabel"
      @click="onClear"
    >
      <AppIcon name="x-mark" :size="14" />
    </button>
  </div>
</template>

<style scoped>
.mp-slider {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.mp-slider__input {
  flex: 1;
  min-width: 0;
  height: 20px;
  margin: 0;
  appearance: none;
  -webkit-appearance: none;
  background: transparent;
  cursor: pointer;
}

.mp-slider__input:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

/* Track — a filled gradient up to the current value, sunken remainder after it. */
.mp-slider__input::-webkit-slider-runnable-track {
  height: 6px;
  border-radius: var(--radius-pill);
  background: linear-gradient(
    to right,
    var(--brand-primary) 0,
    var(--brand-primary) var(--mp-slider-fill),
    var(--surface-sunken) var(--mp-slider-fill),
    var(--surface-sunken) 100%
  );
  border: 1px solid var(--border-default);
}

.mp-slider__input::-moz-range-track {
  height: 6px;
  border-radius: var(--radius-pill);
  background: var(--surface-sunken);
  border: 1px solid var(--border-default);
}

.mp-slider__input::-moz-range-progress {
  height: 6px;
  border-radius: var(--radius-pill);
  background: var(--brand-primary);
}

/* Thumb */
.mp-slider__input::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  margin-top: -8px; /* centers the 20px thumb on the 6px (+2px border) track */
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: #fff;
  border: 2px solid var(--brand-primary);
  box-shadow: var(--shadow-xs);
  transition: transform var(--dur-fast) var(--ease-out);
}

.mp-slider__input::-moz-range-thumb {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #fff;
  border: 2px solid var(--brand-primary);
  box-shadow: var(--shadow-xs);
}

.mp-slider__input:active::-webkit-slider-thumb {
  transform: scale(1.1);
}

.mp-slider__input:focus-visible {
  outline: none;
}

.mp-slider__input:focus-visible::-webkit-slider-thumb {
  box-shadow: var(--shadow-focus);
}

.mp-slider__input:focus-visible::-moz-range-thumb {
  box-shadow: var(--shadow-focus);
}

.mp-slider__value {
  flex: none;
  min-width: 3.5rem;
  text-align: right;
  font: var(--weight-semibold) var(--text-sm) / 1 var(--font-sans);
  color: var(--text-strong);
  font-variant-numeric: tabular-nums;
}

.mp-slider__value--unset {
  font-weight: var(--weight-regular);
  color: var(--text-muted);
}

.mp-slider__clear {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  padding: 0;
  border: 0;
  border-radius: var(--radius-pill);
  background: var(--surface-sunken);
  color: var(--text-muted);
  cursor: pointer;
  transition: color var(--dur-fast) var(--ease-out);
}

.mp-slider__clear:hover {
  color: var(--text-strong);
}

.mp-slider__clear:focus-visible {
  outline: none;
  box-shadow: var(--shadow-focus);
}
</style>
