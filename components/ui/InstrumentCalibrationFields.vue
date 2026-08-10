<script setup lang="ts">
// The two per-pot anchors an instrument may require (the kitchen scale today). TWO of them, because a
// dimensionless 0..1 fraction needs two ends: this pot at container capacity, and this pot dry.
import Input from './Input.vue';
import FormGroup from './FormGroup.vue';
import { toNullableNumber } from '~/utils/nullableNumber';

const model = defineModel<{ saturatedValue: number | null; dryValue: number | null }>({ required: true });
// `offScaleError` is computed by the OWNER of the instrument row (SoilReadingModal.vue), not here: this
// component is deliberately given two numbers and a unit label and knows nothing about which instrument it
// is editing. Passing the resolved sentence in keeps the instrument's bounds read in exactly one place —
// the same reason the unit label arrives as a prop rather than being looked up here.
defineProps<{ unitLabel: string; offScaleError?: string }>();
const { t } = useI18n();

// Bridge between Input.vue's `v-model` (`string | number`) and the DTO's `number | null` fields — same
// pattern (and same shared util) as PlaceEditModal.vue's temperature fields: an empty input reads/writes
// as `null`, never as the empty string reaching the payload.
const saturated = computed<number | string>({
  get: () => model.value.saturatedValue ?? '',
  set: (v) => { model.value.saturatedValue = toNullableNumber(v); },
});
const dry = computed<number | string>({
  get: () => model.value.dryValue ?? '',
  set: (v) => { model.value.dryValue = toNullableNumber(v); },
});

/** The span must be strictly positive — a zero or inverted span is not a scale, and the server refuses it. */
const invalid = computed(() =>
  model.value.saturatedValue != null && model.value.dryValue != null &&
  model.value.saturatedValue <= model.value.dryValue);
</script>

<template>
  <div class="mp-calib">
    <FormGroup :label="t('reading.calibration.saturated', { unit: unitLabel })"
               :hint="t('reading.calibration.saturatedHint')">
      <Input v-model.number="saturated" type="number" inputmode="decimal" min="0" />
    </FormGroup>
    <FormGroup :label="t('reading.calibration.dry', { unit: unitLabel })"
               :hint="t('reading.calibration.dryHint')">
      <Input v-model.number="dry" type="number" inputmode="decimal" min="0" />
    </FormGroup>
    <!-- Off-scale FIRST: a negative weight is a different, more basic fault than an inverted pair, and
         `800 / -500` breaks both. One message, and it must be the one that names the impossible number —
         the same bounds-before-span ordering `rawValueErrorMessage` uses for the reading itself. -->
    <p v-if="offScaleError" class="mp-calib__err">{{ offScaleError }}</p>
    <p v-else-if="invalid" class="mp-calib__err">{{ t('reading.calibration.spanInvalid') }}</p>
  </div>
</template>

<style scoped>
.mp-calib { display: grid; gap: var(--space-3); }
/* `--care-poor`, not a nonexistent `--danger` token — the same red FormGroup.vue's own inline error text
   uses (`.mp-form-group__error`), so this reads as the same "this is wrong" signal everywhere in the app. */
.mp-calib__err { color: var(--care-poor); font-size: var(--text-sm); margin: 0; }
</style>
