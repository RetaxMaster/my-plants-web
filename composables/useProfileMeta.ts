// Single source mapping plant-profile slugs -> i18n labels, and building <select> option lists. Both the
// PlantProfileModal (options) and the care-basis grid (single-value labels) consume this — the enum-value
// wording is never forked. The slug arrays come from the shared package's Zod-free subpath.
import {
  WINDOW_DISTANCES, POT_TYPES, SOIL_MIXES, GROWTH_HABITS,
} from '@retaxmaster/my-plants-species-schema/plant-profile-constants';
import type {
  WindowDist, PotType, SoilMix, GrowthHabit,
} from '@retaxmaster/my-plants-species-schema/plant-profile-constants';

export function useProfileMeta() {
  const { t } = useI18n();

  const options = (values: readonly string[], ns: string) =>
    values.map((v) => ({ value: v, label: t(`plantProfile.${ns}.${v}`) }));

  const label = (v: string | null | undefined, ns: string) =>
    v ? t(`plantProfile.${ns}.${v}`) : null;

  return {
    windowDistanceOptions: computed(() => options(WINDOW_DISTANCES, 'windowDistanceOptions')),
    potTypeOptions: computed(() => options(POT_TYPES, 'potTypeOptions')),
    soilMixOptions: computed(() => options(SOIL_MIXES, 'soilMixOptions')),
    growthHabitOptions: computed(() => options(GROWTH_HABITS, 'growthHabitOptions')),
    windowDistanceLabel: (v: WindowDist | null) => label(v, 'windowDistanceOptions'),
    potTypeLabel: (v: PotType | null) => label(v, 'potTypeOptions'),
    soilMixLabel: (v: SoilMix | null) => label(v, 'soilMixOptions'),
    growthHabitLabel: (v: GrowthHabit | null) => label(v, 'growthHabitOptions'),
  };
}
