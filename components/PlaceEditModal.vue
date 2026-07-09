<script setup lang="ts">
import { AIRFLOW } from '@retaxmaster/my-plants-species-schema/place-constants';
import type { Airflow } from '@retaxmaster/my-plants-species-schema/place-constants';
import type { HumidityCharacter, LightType } from '../types/api.js';
import { HUMIDITY_BAND_DRY_MAX, HUMIDITY_BAND_HUMID_MIN } from '../utils/humidityBands.js';
import { toNullableNumber } from '../utils/nullableNumber.js';

interface EditablePlace {
  id: string;
  name: string;
  indoor: boolean;
  climateControlled: boolean;
  lightType: LightType;
  humidityCharacter: HumidityCharacter | null;
  airflow: Airflow | null;
  indoorTempMinC: number | null;
  indoorTempMaxC: number | null;
}

const props = defineProps<{
  place: EditablePlace | null;
}>();

const emit = defineEmits<{ saved: [] }>();

const api = useApi();

const open = defineModel<boolean>({ default: false });

const { t } = useI18n();
const editName = ref('');
const editClimate = ref(false);
const editLightType = ref<LightType>('BRIGHT_INDIRECT');
const editHumidity = ref<HumidityCharacter | ''>('');
const editAirflow = ref<Airflow | ''>('');
const editTempMinC = ref<number | null>(null);
const editTempMaxC = ref<number | null>(null);
const savingEdit = ref(false);

// UiInput's v-model is `string | number`; the DTO field is `number | null`. Bridge the two so an empty
// input reads/writes as the contract's `null` — same pattern (and same util) as the create form.
const tempMinC = computed<number | string>({
  get: () => editTempMinC.value ?? '',
  set: (v) => { editTempMinC.value = toNullableNumber(v); },
});
const tempMaxC = computed<number | string>({
  get: () => editTempMaxC.value ?? '',
  set: (v) => { editTempMaxC.value = toNullableNumber(v); },
});

// Option labels reuse the SAME places.* keys as the create form, and the humidity bands come from the
// shared humidityBands util — so the two forms can never disagree (one source of truth, no fork).
const lightOptions = computed<{ label: string; value: LightType }[]>(() => [
  { label: t('places.lightOption_DIRECT'), value: 'DIRECT' },
  { label: t('places.lightOption_BRIGHT_INDIRECT'), value: 'BRIGHT_INDIRECT' },
  { label: t('places.lightOption_MEDIUM'), value: 'MEDIUM' },
  { label: t('places.lightOption_LOW'), value: 'LOW' },
]);
const humidityOptions = computed<{ label: string; value: HumidityCharacter | '' }[]>(() => [
  { label: t('places.humidity_NONE'), value: '' },
  { label: t('places.humidityOption_DRY', { max: HUMIDITY_BAND_DRY_MAX }), value: 'DRY' },
  { label: t('places.humidityOption_NORMAL', { min: HUMIDITY_BAND_DRY_MAX, max: HUMIDITY_BAND_HUMID_MIN }), value: 'NORMAL' },
  { label: t('places.humidityOption_HUMID', { min: HUMIDITY_BAND_HUMID_MIN }), value: 'HUMID' },
]);
const airflowOptions = computed(() => [
  { label: t('places.airflow_NONE'), value: '' },
  ...AIRFLOW.map((v) => ({ label: t('places.airflow_' + v), value: v })),
]);

// Whenever the modal opens, seed the fields from the current place.
watch(open, (isOpen) => {
  if (isOpen && props.place) {
    editName.value = props.place.name;
    editClimate.value = props.place.climateControlled;
    editLightType.value = props.place.lightType;
    editHumidity.value = props.place.humidityCharacter ?? '';
    editAirflow.value = props.place.airflow ?? '';
    editTempMinC.value = props.place.indoorTempMinC;
    editTempMaxC.value = props.place.indoorTempMaxC;
  }
});

async function saveEdit() {
  if (!props.place) return;
  savingEdit.value = true;
  try {
    await api.updatePlace(props.place.id, {
      name: editName.value,
      climateControlled: editClimate.value,
      lightType: editLightType.value,
      // Humidity and the indoor temperature bounds are indoor-only concepts; for an outdoor place the
      // engine reads the real weather instead, so we never send them.
      ...(props.place.indoor
        ? {
            humidityCharacter: editHumidity.value === '' ? null : editHumidity.value,
            indoorTempMinC: editTempMinC.value,
            indoorTempMaxC: editTempMaxC.value,
          }
        : {}),
      airflow: editAirflow.value === '' ? null : editAirflow.value,
    });
    emit('saved');
    open.value = false;
  } finally { savingEdit.value = false; }
}
</script>

<template>
  <UiModal v-model="open" :title="$t('placeEdit.title')">
    <div class="mp-edit-form">
      <UiFormGroup :label="$t('placeEdit.name')">
        <UiInput v-model="editName" />
      </UiFormGroup>
      <UiFormGroup :label="$t('placeEdit.climateControlled')">
        <div class="mp-edit-form__switch">
          <UiSwitch v-model="editClimate" />
          <span class="mp-edit-form__switch-text">{{ editClimate ? $t('common.yes') : $t('common.no') }}</span>
        </div>
      </UiFormGroup>
      <UiFormGroup :label="$t('places.light')">
        <UiSelectField v-model="editLightType" :options="lightOptions" />
      </UiFormGroup>
      <UiFormGroup v-if="props.place?.indoor" :label="$t('places.humidityCharacter')">
        <UiSelectField v-model="editHumidity" :options="humidityOptions" />
      </UiFormGroup>
      <UiFormGroup :label="$t('placeEdit.airflow')">
        <UiSelectField v-model="editAirflow" :options="airflowOptions" />
      </UiFormGroup>
      <div v-if="props.place?.indoor" class="mp-edit-form__temps">
        <UiFormGroup :label="$t('places.tempMin')">
          <UiInput v-model.number="tempMinC" type="number" step="0.5" />
        </UiFormGroup>
        <UiFormGroup :label="$t('places.tempMax')">
          <UiInput v-model.number="tempMaxC" type="number" step="0.5" />
        </UiFormGroup>
      </div>
    </div>
    <template #footer>
      <UiButton color="neutral" variant="ghost" @click="open = false">{{ $t('common.cancel') }}</UiButton>
      <UiButton color="primary" :loading="savingEdit" @click="saveEdit">{{ $t('common.save') }}</UiButton>
    </template>
  </UiModal>
</template>

<style scoped>
.mp-edit-form {
  display: grid;
  gap: var(--space-3);
}

.mp-edit-form__switch {
  display: flex;
  align-items: center;
  gap: 12px;
}

.mp-edit-form__temps {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.mp-edit-form__switch-text {
  font: 14px var(--font-sans);
  color: var(--text-muted);
}
</style>
