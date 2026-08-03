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

  /**
   * Prepend an ENABLED empty option so the owner can express "I have no value for this" — and, on a field
   * that already holds one, can go back to expressing it. A `<select>`'s own `placeholder` renders a
   * DISABLED option instead, which can never be re-selected, so the two are not interchangeable: a
   * placeholder says "you have not answered yet", this says "not knowing IS an answer".
   *
   * Lives here rather than in a component because two forms need the identical construction — the plant
   * profile modal and the repot-Done form (QA round-3 defect D2, where the Done form's soil mix offered
   * only a disabled placeholder and so could not be completed at all by an owner who did not know what
   * they had potted into). One implementation, per the project's no-new-forks rule.
   *
   * `notSetLabel` overrides the empty option's wording where the generic "Not set" would be wrong: the
   * growth-habit field shows the INHERITED habit there, the repot-Done mix shows "I don't know".
   */
  const withNotSet = (opts: { value: string; label: string }[], notSetLabel?: string | null) =>
    [{ value: '', label: notSetLabel ?? t('plantProfile.pickOption') }, ...opts];

  return {
    withNotSet,
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
