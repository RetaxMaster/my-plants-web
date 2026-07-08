<script setup lang="ts">
import { AIRFLOW } from '@retaxmaster/my-plants-species-schema/place-constants';
import type { Airflow } from '@retaxmaster/my-plants-species-schema/place-constants';
import type { HumidityCharacter, LightType } from '../types/api.js';
import { HUMIDITY_BAND_DRY_MAX, HUMIDITY_BAND_HUMID_MIN } from '../utils/humidityBands.js';

interface EditablePlace {
  id: string;
  name: string;
  indoor: boolean;
  climateControlled: boolean;
  lightType: LightType;
  humidityCharacter: HumidityCharacter | null;
  airflow: Airflow | null;
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
const savingEdit = ref(false);

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
      // Humidity is an indoor-only concept; for an outdoor place we never send it.
      ...(props.place.indoor ? { humidityCharacter: editHumidity.value === '' ? null : editHumidity.value } : {}),
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

.mp-edit-form__switch-text {
  font: 14px var(--font-sans);
  color: var(--text-muted);
}
</style>
