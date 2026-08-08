<script setup lang="ts">
// The "Add missing info" editor for a plant's optional physical profile (spec 1 vocabulary). Prefills
// from GET /plants/:id/profile and saves via PATCH (partial merge: empty enum/number -> null clears the
// field). Enum options + labels come from useProfileMeta so wording is never forked with the care-basis
// grid. Booleans are switches (spec choice): once saved they become explicit true/false.
import type { PlantProfile, PlantProfileUpdate } from '../types/api.js';
import type { GrowthHabit } from '@retaxmaster/my-plants-species-schema/plant-profile-constants';

const props = defineProps<{ plantId: string; speciesGrowthHabit?: GrowthHabit | null }>();
const emit = defineEmits<{ saved: [{ soilMixChanged: boolean }] }>();
const open = defineModel<boolean>({ default: false });

const { t } = useI18n();
const api = useApi();
const {
  windowDistanceOptions, potTypeOptions, soilMixOptions, growthHabitOptions, growthHabitLabel, withNotSet,
} = useProfileMeta();

const loading = ref(false);
const saving = ref(false);

// Local editable state. Enums use '' for "not set"; numbers use '' for empty; booleans are plain.
// potSizeCm is driven by UiSlider, whose unset state is `null` rather than ''.
const windowDistance = ref('');
const potType = ref('');
const soilMix = ref('');
// Snapshot of the LOADED soil mix, so `save()` can report whether the owner actually changed it (A3,
// spec §2.3) — the modal reports the fact upward; it does not act on it. See `save()`.
const loadedSoilMix = ref('');
const growthHabit = ref('');
const growLight = ref(false);
const hasDrainage = ref(false);
const nearHeater = ref(false);
const potSizeCm = ref<number | null>(null);
const ageMonths = ref<number | string>('');

// Pot-diameter bounds — cm. The engine's size factor saturates a little past POT_REF_CM + 23 (~38 cm),
// so 50 comfortably covers every pot that still moves the watering calc.
const POT_SIZE_MIN = 5;
const POT_SIZE_MAX = 50;
const POT_SIZE_STEP = 1;

// `withNotSet` now lives in `useProfileMeta()` (destructured above) — the repot-Done form needs the exact
// same enabled-empty-option construction, and two copies of it is the fork this project's rules forbid.
// Its contract, including the `notSetLabel` override this file's growth-habit field uses to show the
// INHERITED habit, is documented at the definition. Kept in mind here: passing a SelectField
// `:placeholder` ON TOP of it produces a SECOND, disabled `<option value="">` (QA defect F), because
// SelectField.vue renders its own placeholder option whenever `placeholder` is truthy — the two are
// alternatives, never a pair.

// The provenance line, shown ONLY while the owner has not chosen a habit themselves. This mirrors the
// API's read-time fallback exactly; the web never copies the inherited value into the patch.
const inheritedHabitLabel = computed(() =>
  !growthHabit.value && props.speciesGrowthHabit
    ? t('plantProfile.growthHabitInheritedValue', {
        habit: growthHabitLabel(props.speciesGrowthHabit),
      })
    : null,
);
// `trailing` sets HABIT_REF to null, which removes the crowding signal entirely. SAY so, rather than
// letting the owner discover it by silence.
const showsTrailingWarning = computed(() => growthHabit.value === 'trailing');

watch(open, async (isOpen) => {
  if (!isOpen) return;
  loading.value = true;
  try {
    const p = await api.getPlantProfile(props.plantId);
    windowDistance.value = p.windowDistance ?? '';
    potType.value = p.potType ?? '';
    soilMix.value = p.soilMix ?? '';
    loadedSoilMix.value = soilMix.value;
    growthHabit.value = p.growthHabit ?? '';
    growLight.value = p.growLight === true;
    hasDrainage.value = p.hasDrainage === true;
    nearHeater.value = p.nearHeater === true;
    potSizeCm.value = p.potSizeCm ?? null;
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
      potSizeCm: potSizeCm.value,
      ageMonths: num(ageMonths.value),
    };
    await api.updatePlantProfile(props.plantId, patch);
    // A3 (spec §2.3) — report the fact, do not act on it. The mix says HOW MUCH charge; the refresh date
    // says FROM WHEN, and with no date there is no fertilize clock to anchor. Saving a new mix therefore
    // correctly changes the WATERING model (the mix carries W_SOIL weight in the optional channel) and
    // correctly changes nothing for feeding — which the owner read as "the engine is broken" and answered
    // with a manual postpone, which is what set up A1. The plant page turns this flag into the existing
    // repot-completion flow; this modal adds NO fourth writer of `substrate_refreshed_on`.
    const soilMixChanged = (soilMix.value || null) !== (loadedSoilMix.value || null);
    emit('saved', { soilMixChanged });
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
      <!-- potSizeCm is the pot's RIM DIAMETER — the engine's assumption (see docs/care-engine.md: it feeds the
           watering pot-factor and the crowding index R = heightCm / potSizeCm). The label + hint make that
           explicit so a user never enters the radius, which would halve every downstream calc. -->
      <UiFormGroup :label="$t('plantProfile.potSize')" :hint="$t('plantProfile.potSizeHint')">
        <UiSlider
          v-model="potSizeCm"
          :min="POT_SIZE_MIN"
          :max="POT_SIZE_MAX"
          :step="POT_SIZE_STEP"
          :suffix="$t('plantProfile.potSizeSuffix')"
          :placeholder="$t('plantProfile.pickOption')"
          :clear-label="$t('plantProfile.clearPotSize')"
          clearable
        />
      </UiFormGroup>
      <UiFormGroup :label="$t('plantProfile.soilMix')">
        <UiSelectField v-model="soilMix" :options="withNotSet(soilMixOptions)" />
      </UiFormGroup>
      <UiFormGroup :label="$t('plantProfile.growthHabit')" :hint="$t('plantProfile.growthHabitHelp')">
        <UiSelectField
          v-model="growthHabit"
          data-test="growth-habit-select"
          :options="withNotSet(growthHabitOptions, inheritedHabitLabel)"
        />
        <p v-if="inheritedHabitLabel" class="mp-form__note">{{ inheritedHabitLabel }}</p>
        <p v-if="showsTrailingWarning" class="mp-form__note mp-form__note--warn">
          {{ $t('plantProfile.growthHabitTrailingWarning') }}
        </p>
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
      <UiButton color="primary" data-test="profile-save" :loading="saving" :disabled="loading" @click="save">{{ $t('common.save') }}</UiButton>
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

/* Reuses the same wording tone as UiFormGroup's own `__hint`/`__error` (text-xs, muted-by-default); the
   `--warn` variant borrows the engine's existing caution color token rather than inventing a new one.
   UiFormGroup lays its slot out as a `gap`-ped flex column, so these notes need no margin of their own. */
.mp-form__note {
  margin: 0;
  font: var(--text-xs) / 1.4 var(--font-sans);
  color: var(--text-muted);
}

.mp-form__note--warn {
  color: var(--care-caution-text);
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
