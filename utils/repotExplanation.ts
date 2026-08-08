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
// separately says whether a postponement is what is binding the date currently shown. Both can be true at
// once, so when an override is binding, its sentence is APPENDED after the driver sentence — never
// substituted in its place.
//
// WHICH override sentence (QA round 5, finding 1). There used to be exactly one — "You postponed this
// reminder to the date shown" — and it was shown for EVERY binding override. But a REPOT override has TWO
// possible authors: the owner pressing Postpone, and the questionnaire answering "not yet", which writes
// no care event and involves no owner decision at all. On the second path the app told the owner they had
// done something they never did, and contradicted the "Already checked — we'll ask again on <date>" note
// rendered directly beside it in the same row.
//
// So the sentence is chosen by `repotOverrideOrigin`, which the API reads off the override row itself.
// The ABSENT/unknown case is deliberately NOT folded into either of the two named ones: an older API (or
// any future writer that forgets to stamp an origin) must fall back to the sentence that is true of both
// authors — the date moved — rather than re-asserting the very attribution this fix removed. Deleting the
// sentence outright was considered and refused: knowing WHY the date moved is the useful half; only the
// attribution was wrong.
export function repotExplanation(
  substrate: PlantCare['substrate'] | null | undefined,
  t: (key: string) => string,
): string | undefined {
  if (!substrate || !substrate.repotDriver) return undefined;
  const driver =
    substrate.repotDriver === 'SUBSTRATE'
      ? t('taskInfo.substrate.repotDriverSubstrate')
      : t('taskInfo.substrate.repotDriverCrowding');
  if (!substrate.repotOverrideBinding) return driver;
  const override =
    substrate.repotOverrideOrigin === 'OWNER'
      ? t('taskInfo.substrate.repotOverrideOwner')
      : substrate.repotOverrideOrigin === 'EVALUATION'
        ? t('taskInfo.substrate.repotOverrideEvaluation')
        : t('taskInfo.substrate.repotOverrideMoved');
  return `${driver} ${override}`;
}
