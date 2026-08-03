import type { PlantCare } from '../types/api.js';

// Extracted out of `PlantDetail.vue`'s `taskExplanation` REPOT branch (substrate:13 final ruling) so this
// composition — which sentence to show, and in what order — has its OWN unit test, instead of being
// exercised only indirectly through the component suite/typecheck/build. The `t` translator is INJECTED
// rather than imported from `useI18n` here, precisely so this stays a plain function a test can call
// without mounting Vue or Nuxt's i18n runtime.
//
// Load-bearing rule (do not "simplify" this away): `repotDriver` and `repotOverrideBinding` are TWO
// INDEPENDENT FACTS, never one replacing the other. `repotDriver` says what the engine's own estimate is
// based on (substrate wearing out vs. crowding) — always true, driver-dependent. `repotOverrideBinding`
// separately says whether the owner's own postponement is what is binding the date currently shown. Both
// can be true at once, so when an override is binding, its sentence is APPENDED after the driver sentence
// — never substituted in its place.
export function repotExplanation(
  substrate: PlantCare['substrate'] | null | undefined,
  t: (key: string) => string,
): string | undefined {
  if (!substrate || !substrate.repotDriver) return undefined;
  const driver =
    substrate.repotDriver === 'SUBSTRATE'
      ? t('taskInfo.substrate.repotDriverSubstrate')
      : t('taskInfo.substrate.repotDriverCrowding');
  return substrate.repotOverrideBinding
    ? `${driver} ${t('taskInfo.substrate.repotOverrideBinding')}`
    : driver;
}
