<script setup lang="ts">
// The "Add missing info" editor for a plant's optional physical profile (spec 1 vocabulary). Prefills
// from GET /plants/:id/profile and saves via PATCH (partial merge: empty enum/number -> null clears the
// field). Enum options + labels come from useProfileMeta so wording is never forked with the care-basis
// grid. Booleans are switches (spec choice): once saved they become explicit true/false.
import type { PlantProfile, PlantProfileUpdate } from '../types/api.js';

const props = defineProps<{ plantId: string }>();
const emit = defineEmits<{ saved: [] }>();
const open = defineModel<boolean>({ default: false });

const { t } = useI18n();
const api = useApi();
const {
  windowDistanceOptions, potTypeOptions, soilMixOptions, growthHabitOptions,
} = useProfileMeta();

const loading = ref(false);
const saving = ref(false);

// Local editable state. Enums use '' for "not set"; numbers use '' for empty; booleans are plain.
const windowDistance = ref('');
const potType = ref('');
const soilMix = ref('');
const growthHabit = ref('');
const growLight = ref(false);
const hasDrainage = ref(false);
const nearHeater = ref(false);
const potSizeCm = ref<number | string>('');
const ageMonths = ref<number | string>('');

// Prepend an enabled "Not set" option so a user can CLEAR an enum (a disabled placeholder can't be reselected).
const withNotSet = (opts: { value: string; label: string }[]) =>
  [{ value: '', label: t('plantProfile.pickOption') }, ...opts];

watch(open, async (isOpen) => {
  if (!isOpen) return;
  loading.value = true;
  try {
    const p = await api.getPlantProfile(props.plantId);
    windowDistance.value = p.windowDistance ?? '';
    potType.value = p.potType ?? '';
    soilMix.value = p.soilMix ?? '';
    growthHabit.value = p.growthHabit ?? '';
    growLight.value = p.growLight === true;
    hasDrainage.value = p.hasDrainage === true;
    nearHeater.value = p.nearHeater === true;
    potSizeCm.value = p.potSizeCm ?? '';
    ageMonths.value = p.ageMonths ?? '';
  } finally {
    loading.value = false;
  }
});

// Coerce the field's value to a finite number, or null to clear. UiInput honors v-model.number (it
// emits a real number), but we also parse a finite numeric string defensively so the modal stays
// correct independently of the input's coercion. An empty value clears the field (null).
function num(v: number | string): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const trimmed = v.trim();
  if (trimmed === '') return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

async function save() {
  saving.value = true;
  try {
    const patch: PlantProfileUpdate = {
      windowDistance: (windowDistance.value || null) as PlantProfile['windowDistance'],
      potType: (potType.value || null) as PlantProfile['potType'],
      soilMix: (soilMix.value || null) as PlantProfile['soilMix'],
      growthHabit: (growthHabit.value || null) as PlantProfile['growthHabit'],
      growLight: growLight.value,
      hasDrainage: hasDrainage.value,
      nearHeater: nearHeater.value,
      potSizeCm: num(potSizeCm.value),
      ageMonths: num(ageMonths.value),
    };
    await api.updatePlantProfile(props.plantId, patch);
    emit('saved');
    open.value = false;
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <UiModal v-model="open" :title="$t('plantProfile.title')">
    <p class="mp-profile__subtitle">{{ $t('plantProfile.subtitle') }}</p>
    <div v-if="loading" class="mp-profile__loading">{{ $t('common.loading') }}</div>
    <div v-else class="mp-profile__form">
      <UiFormGroup :label="$t('plantProfile.windowDistance')">
        <UiSelectField v-model="windowDistance" :options="withNotSet(windowDistanceOptions)" />
      </UiFormGroup>
      <UiFormGroup :label="$t('plantProfile.potType')">
        <UiSelectField v-model="potType" :options="withNotSet(potTypeOptions)" />
      </UiFormGroup>
      <UiFormGroup :label="$t('plantProfile.potSize')">
        <UiInput v-model.number="potSizeCm" type="number" min="1" step="1" />
      </UiFormGroup>
      <UiFormGroup :label="$t('plantProfile.soilMix')">
        <UiSelectField v-model="soilMix" :options="withNotSet(soilMixOptions)" />
      </UiFormGroup>
      <UiFormGroup :label="$t('plantProfile.growthHabit')">
        <UiSelectField v-model="growthHabit" :options="withNotSet(growthHabitOptions)" />
      </UiFormGroup>
      <UiFormGroup :label="$t('plantProfile.ageMonths')">
        <UiInput v-model.number="ageMonths" type="number" min="0" step="1" />
      </UiFormGroup>
      <label class="mp-profile__switch">
        <UiSwitch v-model="growLight" :aria-label="$t('plantProfile.growLight')" />
        <span>{{ $t('plantProfile.growLight') }}</span>
      </label>
      <label class="mp-profile__switch">
        <UiSwitch v-model="hasDrainage" :aria-label="$t('plantProfile.hasDrainage')" />
        <span>{{ $t('plantProfile.hasDrainage') }}</span>
      </label>
      <label class="mp-profile__switch">
        <UiSwitch v-model="nearHeater" :aria-label="$t('plantProfile.nearHeater')" />
        <span>{{ $t('plantProfile.nearHeater') }}</span>
      </label>
    </div>
    <template #footer>
      <UiButton color="neutral" variant="ghost" @click="open = false">{{ $t('common.cancel') }}</UiButton>
      <UiButton color="primary" :loading="saving" :disabled="loading" @click="save">{{ $t('common.save') }}</UiButton>
    </template>
  </UiModal>
</template>

<style scoped>
.mp-profile__subtitle {
  margin: 0 0 var(--space-4);
  font: var(--text-sm) / 1.4 var(--font-sans);
  color: var(--text-muted);
}

.mp-profile__loading {
  font-family: var(--font-sans);
  color: var(--text-muted);
}

.mp-profile__form {
  display: grid;
  gap: var(--space-4);
}

.mp-profile__switch {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  font: var(--text-sm) var(--font-sans);
  color: var(--text-strong);
  cursor: pointer;
}
</style>
