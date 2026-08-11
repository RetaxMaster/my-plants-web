<script setup lang="ts">
// The calibration surface for a pot's kitchen scale — SETUP, done once ahead of time, never mid-decision.
//
// ⚠️ WHY THIS EXISTS SEPARATELY FROM SoilReadingModal.vue (owner-ruled 2026-08-10). The two per-pot anchors
// used to live INSIDE the measuring modal, including in its `survey` mode — the flow that answers "should I
// water this pot today?". That is CIRCULAR: one of the two anchors is "the pot freshly watered", and
// supplying it means watering the plant — the exact decision the survey has not made yet. The primary
// button stayed disabled until both weights were filled, so a survey on an uncalibrated pot could not be
// completed AT ALL. No test caught it because every fixture either already had a calibration or used a
// different instrument. See docs/superpowers/specs/2026-08-10-the-survey-stops-asking-design.md §1/§3.4.
//
// The owner's ruling, verbatim in substance: *"es una calibración, es una configuración que se debe hacer
// desde antes."* So this modal is reached from the plant page as its own affordance, not from the measuring
// flow. `SoilReadingModal.vue` loses its calibration block in a later task (the same spec's §3.4/§5 MOVED
// table) — until then the same fields exist in both places, which is harmless: the owner can calibrate from
// either surface and both write through the same `PUT .../calibration/:instrumentId` route.
//
// ⚠️ BOTH ANCHORS CAN BE TAKEN THE SAME DAY, and the copy below says so. The obvious-sounding "measure dry
// today, water tomorrow, measure again" is not the better protocol — same pot, same substrate, no growth in
// between is. Weigh dry (right before you'd normally water) → water → let it drain → weigh again.
import Modal from './Modal.vue';
import Button from './Button.vue';
import FormGroup from './FormGroup.vue';
import SegmentedControl from './SegmentedControl.vue';
import Alert from './Alert.vue';
import InstrumentCalibrationFields from './InstrumentCalibrationFields.vue';
import type { InstrumentId } from '@retaxmaster/my-plants-species-schema/soil-instrument-constants';
import type { PlantSoilReadings } from '~/types/api';

const props = defineProps<{
  plantId: string;
  data: PlantSoilReadings;
}>();
const emit = defineEmits<{ saved: [] }>();
const open = defineModel<boolean>('open', { default: false });

const { t } = useI18n();
const api = useApi();

// This IS a calibration-setup surface, so an instrument that never needs calibration (the probe, the stick,
// the finger) has no business appearing in its picker at all — offering it renders no fields, fires no
// alert, and leaves Save permanently disabled: a dead option, found in review. Every list below is built off
// THIS filtered set, never off `props.data.instruments` directly.
const calibratableInstruments = computed(() =>
  props.data.instruments.filter((i) => i.requiresCalibration));

// Same '' sentinel convention `SoilReadingModal.vue`'s own `instrumentId` uses (SegmentedControl's model is
// a plain non-nullable `string`, and '' means "nothing chosen yet").
const instrumentId = ref<InstrumentId | ''>(calibratableInstruments.value[0]?.id ?? '');
const calibration = reactive<{ saturatedValue: number | null; dryValue: number | null }>({
  saturatedValue: null, dryValue: null,
});
const submitting = ref(false);
const error = ref<string | null>(null);

const options = computed(() =>
  calibratableInstruments.value.map((i) => ({ key: i.id, label: t(`settings.instruments.name.${i.id}`) })));
const instrument = computed(() =>
  calibratableInstruments.value.find((i) => i.id === instrumentId.value) ?? null);
// NOTE: there used to be a separate `showsCalibration` computed here (`instrument.value?.requiresCalibration
// === true`) meant to gate the fields on the chosen instrument actually needing calibration. Once `instrument`
// was rewired to resolve only from `calibratableInstruments` (finding A), that condition became true whenever
// `instrument` resolves at all — no fixture could ever make it false, so it was decoration wearing a guard's
// comment. Removed; `instrument` resolving is now the single, honest condition the template and `canSave`
// both check.

/** The anchors as the SERVER currently holds them, for this instrument, or `null`. */
const storedCalibration = computed(() => instrument.value?.calibration ?? null);

/** Pull the stored anchors into the editable fields — on open, on setup, and on every instrument switch,
 *  the moments the fields stop describing whatever instrument they described before. Anchors are per
 *  (pot, instrument): switching instruments must never carry one instrument's numbers onto another's scale. */
function syncCalibrationFromStored() {
  calibration.saturatedValue = storedCalibration.value?.saturatedValue ?? null;
  calibration.dryValue = storedCalibration.value?.dryValue ?? null;
}
syncCalibrationFromStored();

watch(open, (isOpen) => {
  if (!isOpen) return;
  error.value = null;
  submitting.value = false;
  if (instrumentId.value === '' && calibratableInstruments.value[0]) {
    instrumentId.value = calibratableInstruments.value[0].id;
  }
  syncCalibrationFromStored();
});

watch(instrumentId, () => {
  syncCalibrationFromStored();
  error.value = null;
});

/** Has the owner actually moved the anchors? Drives whether `save()` writes at all — re-`PUT`ting identical
 *  numbers is not merely wasteful, it is a request the API must reason about: an anchor MOVE is treated as a
 *  retraction of every wetness fraction those anchors produced, so it must see only real moves. */
const calibrationChanged = computed(() => {
  const stored = storedCalibration.value;
  if (calibration.saturatedValue == null || calibration.dryValue == null) return false;
  if (stored == null) return true;
  return stored.saturatedValue !== calibration.saturatedValue
    || stored.dryValue !== calibration.dryValue;
});

/**
 * MOVED (not copied) from `SoilReadingModal.vue`'s own `calibrationOffScale`, 2026-08-10 — read there, this
 * is the same logic. NOT deleted at the source: a later task removes the calibration block from that modal
 * entirely, together with the test cases it owns (see this file's own test header). Until then the identical
 * computation lives in both files, which is harmless — both write through the same shared-contract-bound
 * `PUT .../calibration/:instrumentId` route, which refuses an off-scale anchor regardless of which surface
 * sent it. This exists so the owner never reaches that refusal by accident.
 */
const calibrationOffScale = computed(() => {
  const row = instrument.value;
  if (row == null) return undefined;
  const offScale = (v: number | null) =>
    v != null && (v < row.rawMin || (row.rawMax != null && v > row.rawMax));
  if (offScale(calibration.saturatedValue) || offScale(calibration.dryValue)) {
    return row.rawMax == null
      ? t('reading.calibration.belowMin', { min: row.rawMin })
      : t('reading.calibration.outOfRange', { min: row.rawMin, max: row.rawMax });
  }
  return undefined;
});

/** The anchors are usable: both present, ordered, and each one on the instrument's scale. */
const calibrationUsable = computed(() =>
  calibration.saturatedValue != null && calibration.dryValue != null &&
  calibration.saturatedValue > calibration.dryValue && calibrationOffScale.value === undefined);

// Same guard `SoilReadingModal.vue`'s own `valueUnitLabel` uses: an ordinal instrument has no physical unit
// to name, so `InstrumentCalibrationFields` is handed an empty label rather than a raw, untranslated key.
const valueUnitLabel = computed(() =>
  instrument.value && instrument.value.captureKind !== 'ordinal'
    ? t(`settings.instruments.unit.${instrument.value.id}`)
    : '');

const canSave = computed(() =>
  instrumentId.value !== '' && instrument.value != null && !submitting.value && calibrationUsable.value);

/**
 * Save the anchors — only when they actually CHANGED (see `calibrationChanged`'s own comment) — then emit
 * `saved` regardless, so the page can refresh what it shows for this pot. A no-op save (the owner opened the
 * dialog, looked, and pressed Save without touching anything) is still a legitimate close: nothing needs
 * writing, but the caller still gets its refresh signal rather than having to guess whether anything changed.
 */
async function save() {
  if (!canSave.value || instrumentId.value === '') return;
  const chosenInstrumentId = instrumentId.value;
  submitting.value = true;
  error.value = null;
  try {
    if (calibrationChanged.value) {
      await api.setInstrumentCalibration(props.plantId, chosenInstrumentId, {
        saturatedValue: calibration.saturatedValue as number,
        dryValue: calibration.dryValue as number,
      });
    }
    emit('saved');
    open.value = false;
  } catch {
    // Generic recovery — the same message /settings already uses for this exact route family, so the owner
    // sees one consistent sentence for "your calibration write failed" wherever it happens.
    error.value = t('settings.instruments.saveFailed');
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <Modal v-model="open" :title="t('reading.calibration.modalTitle')">
    <p class="mp-plant-calib__once">{{ t('reading.calibration.once') }}</p>
    <p class="mp-plant-calib__how">{{ t('reading.calibration.how') }}</p>

    <!-- Two DISTINCT empty states — collapsing them into one message was the defect a review caught here.
         "No instruments enabled at all" is a real setup gap and sends the owner to Settings, exactly like
         `SoilReadingModal.vue`'s own empty state (same `reading.noInstruments` key, same `i18n-t` + NuxtLink
         rendering so the sentence stays ONE translatable unit instead of a concatenation with the link
         silently dropped). "Instruments enabled, but none of them needs calibration" is a normal terminal
         state, not a failure — the owner already did what Settings would ask, so it gets its own key and
         never sends them there to "fix" something that isn't broken. -->
    <Alert v-if="data.instruments.length === 0" color="amber">
      <i18n-t keypath="reading.noInstruments" tag="span">
        <template #settings>
          <NuxtLink to="/settings" class="mp-plant-calib__link" @click="open = false">
            {{ t('reading.settingsLink') }}
          </NuxtLink>
        </template>
      </i18n-t>
    </Alert>
    <Alert
      v-else-if="calibratableInstruments.length === 0"
      color="green"
      :description="t('reading.calibration.noneCalibratable')"
    />
    <template v-else>
      <FormGroup v-if="calibratableInstruments.length > 1" :label="t('reading.instrument')">
        <SegmentedControl v-model="instrumentId" :options="options" />
      </FormGroup>

      <InstrumentCalibrationFields
        v-if="instrument"
        v-model="calibration"
        :unit-label="valueUnitLabel"
        :off-scale-error="calibrationOffScale"
      />
    </template>

    <Alert v-if="error" color="red" :description="error" announce />

    <template #footer>
      <Button variant="ghost" @click="open = false">{{ t('common.cancel') }}</Button>
      <Button :disabled="!canSave" :loading="submitting" @click="save">
        {{ t('reading.calibration.save') }}
      </Button>
    </template>
  </Modal>
</template>

<style scoped>
.mp-plant-calib__once {
  margin: 0 0 var(--space-2);
  font-size: var(--text-sm);
  font-weight: var(--weight-semibold);
  color: var(--text-strong);
}
.mp-plant-calib__how {
  margin: 0 0 var(--space-4);
  font-size: var(--text-sm);
  color: var(--text-faint);
}
/* Same treatment as `SoilReadingModal.vue`'s own `.mp-reading__link` — inherits the alert's colour so it
   reads as part of the sentence, underlined so it still reads as a link. */
.mp-plant-calib__link {
  color: inherit;
  text-decoration: underline;
  font-weight: var(--weight-semibold);
}
</style>
