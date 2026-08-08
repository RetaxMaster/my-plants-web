<script setup lang="ts">
// The measuring modal (spec §4.6). Reuses the canonical Modal. There is NO new task and no mode: this is an
// affordance on the WATER task, and the verdict routes onto the postpone / early-water paths that already
// exist.
import Modal from './Modal.vue';
import Button from './Button.vue';
import Input from './Input.vue';
import FormGroup from './FormGroup.vue';
import SegmentedControl from './SegmentedControl.vue';
import Alert from './Alert.vue';
import InstrumentCalibrationFields from './InstrumentCalibrationFields.vue';
// `InstrumentId` has a Zod-free subpath in the shared contract; `ReadingVerdict` does not (see
// `types/api.ts`'s own comment on this) and is re-declared there instead of imported from the Zod module,
// exactly like `PlantSoilReadings` — so it comes from `~/types/api`, never from `soil-instrument-constants`.
import type { InstrumentId } from '@retaxmaster/my-plants-species-schema/soil-instrument-constants';
import type { PlantSoilReadings, ReadingVerdict } from '~/types/api';
import { toNullableNumber } from '~/utils/nullableNumber';

const props = defineProps<{ plantId: string; data: PlantSoilReadings }>();
const emit = defineEmits<{ saved: [] }>();
const open = defineModel<boolean>('open', { default: false });

const { t } = useI18n();
const api = useApi();

// SegmentedControl's own model is a plain, non-nullable `string` (`defineModel<string>({ required: true
// })`) — '' is the "nothing chosen yet" sentinel, the same convention RepotDoneForm.vue/PlaceEditModal.vue
// already use for an unanswered field, rather than `null` (which SegmentedControl cannot accept).
const instrumentId = ref<InstrumentId | ''>(props.data.instruments[0]?.id ?? '');
const rawValue = ref<number | null>(null);
const verdict = ref<ReadingVerdict>('NONE');
const postponeToOn = ref<string>('');
const calibration = reactive<{ saturatedValue: number | null; dryValue: number | null }>({
  saturatedValue: null, dryValue: null,
});
const submitting = ref(false);
const error = ref<string | null>(null);

// Bridge between Input.vue's `v-model` (`string | number`) and `rawValue`'s `number | null` — same pattern
// (and same shared util) as PlaceEditModal.vue's temperature fields.
const rawValueField = computed<number | string>({
  get: () => rawValue.value ?? '',
  set: (v) => { rawValue.value = toNullableNumber(v); },
});

// PINNED idempotency key: minted once when the modal opens and reused on every retry, so a create whose
// response is lost after the server committed never writes a second reading.
const idempotencyKey = ref(crypto.randomUUID());
watch(open, (isOpen) => {
  if (!isOpen) return;
  idempotencyKey.value = crypto.randomUUID();
  error.value = null;
  rawValue.value = null;
  verdict.value = 'NONE';
});

const options = computed(() =>
  props.data.instruments.map((i) => ({ key: i.id, label: t(`settings.instruments.name.${i.id}`) })));
const instrument = computed(() =>
  props.data.instruments.find((i) => i.id === instrumentId.value) ?? null);
const needsCalibration = computed(() =>
  instrument.value?.requiresCalibration === true && instrument.value.calibration == null);

// The date the browser must not let the owner exceed: a reading in the future is not a measurement.
const todayYmd = computed(() => new Date().toLocaleDateString('en-CA'));
const measuredOn = ref(todayYmd.value);

const canSubmit = computed(() =>
  instrumentId.value !== '' && rawValue.value != null && !submitting.value &&
  (verdict.value !== 'POSTPONE' || postponeToOn.value !== '') &&
  (!needsCalibration.value ||
    (calibration.saturatedValue != null && calibration.dryValue != null &&
     calibration.saturatedValue > calibration.dryValue)));

async function submit() {
  if (!canSubmit.value || instrumentId.value === '' || rawValue.value == null) return;
  const chosenInstrumentId = instrumentId.value;
  const chosenRawValue = rawValue.value;
  submitting.value = true;
  error.value = null;
  try {
    // The calibration is saved FIRST when the pot has none: the reading's normalisation reads it, so a
    // reading written before it would be stored with a null wetness and never enter the estimator.
    if (needsCalibration.value) {
      await api.setInstrumentCalibration(props.plantId, chosenInstrumentId, {
        saturatedValue: calibration.saturatedValue as number,
        dryValue: calibration.dryValue as number,
      });
    }
    await api.recordSoilReading(props.plantId, {
      instrumentId: chosenInstrumentId,
      rawValue: chosenRawValue,
      measuredOn: measuredOn.value,
      verdict: verdict.value,
      ...(verdict.value === 'POSTPONE' ? { postponeToOn: postponeToOn.value } : {}),
    }, idempotencyKey.value);
    open.value = false;
    emit('saved');
  } catch {
    error.value = t('reading.saveFailed');
  } finally {
    submitting.value = false;
  }
}

const verdictOptions = computed(() => [
  { key: 'NONE', label: t('reading.verdict.none') },
  { key: 'POSTPONE', label: t('reading.verdict.postpone') },
  { key: 'WATER_NOW', label: t('reading.verdict.waterNow') },
]);
</script>

<template>
  <Modal v-model="open" :title="t('reading.title')">
    <Alert v-if="data.instruments.length === 0" color="amber">
      {{ t('reading.noInstruments') }}
    </Alert>

    <template v-else>
      <!-- Two options today → segmented control (design-system rule: up to 3–4 short options). -->
      <FormGroup :label="t('reading.instrument')">
        <SegmentedControl v-model="instrumentId" :options="options" />
      </FormGroup>

      <!-- The PROTOCOL. Fixed depth and position are not decoration: deeper soil is wetter, so a varying
           depth manufactures a trend that does not exist. -->
      <Alert v-if="data.protocol" color="amber">
        {{ t('reading.protocol', {
          depth: data.protocol.insertionDepthCm,
          distance: data.protocol.distanceFromCentreCm,
        }) }}
      </Alert>
      <Alert v-else color="amber">{{ t('reading.protocolUnknownPot') }}</Alert>

      <!-- One line, instrument-specific. The comparison table lives in /settings, not here. -->
      <p v-if="instrument" class="mp-reading__note">
        {{ t(`reading.honesty.${instrument.id}`) }}
      </p>

      <InstrumentCalibrationFields
        v-if="needsCalibration && instrument"
        v-model="calibration"
        :unit-label="t(`settings.instruments.unit.${instrument.id}`)"
      />

      <FormGroup :label="t('reading.value', { unit: instrument ? t(`settings.instruments.unit.${instrument.id}`) : '' })">
        <Input
          v-model.number="rawValueField"
          type="number"
          inputmode="decimal"
          :min="instrument?.rawMin"
          :max="instrument?.rawMax ?? undefined"
          :step="instrument?.rawStep"
        />
      </FormGroup>

      <FormGroup :label="t('reading.measuredOn')">
        <Input v-model="measuredOn" type="date" :max="todayYmd" />
      </FormGroup>

      <FormGroup :label="t('reading.verdictLabel')" :hint="t('reading.verdictHint')">
        <SegmentedControl v-model="verdict" :options="verdictOptions" />
      </FormGroup>

      <FormGroup v-if="verdict === 'POSTPONE'" :label="t('reading.postponeTo')">
        <Input v-model="postponeToOn" type="date" :min="todayYmd" />
      </FormGroup>

      <Alert v-if="error" color="red" :description="error" announce />
    </template>

    <template #footer>
      <Button variant="ghost" @click="open = false">{{ t('common.cancel') }}</Button>
      <Button :disabled="!canSubmit" :loading="submitting" @click="submit">
        {{ t('reading.save') }}
      </Button>
    </template>
  </Modal>
</template>

<style scoped>
.mp-reading__note { color: var(--text-faint); font-size: var(--text-sm); margin: var(--space-2) 0 var(--space-3); }
</style>
