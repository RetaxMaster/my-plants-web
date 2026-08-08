import type { PlantCare } from '../types/api.js';

// Extracted out of `PlantDetail.vue`'s `taskExplanation` REPOT branch (substrate:13 final ruling) so this
// composition — which sentence to show, and in what order — has its OWN unit test, instead of being
// exercised only indirectly through the component suite/typecheck/build. The `t` translator is INJECTED
// rather than imported from `useI18n` here, precisely so this stays a plain function a test can call
// without mounting Vue or Nuxt's i18n runtime.
//
// Load-bearing rule (do not "simplify" this away): `repotDriver` and `repotOverrideBinding` are TWO
// INDEPENDENT FACTS, never one replacing the other. `repotDriver` says what the engine's own estimate is
// based on — always true, driver-dependent. `repotOverrideBinding` separately says whether a postponement
// is what is binding the date currently shown. Both can be true at once, so when an override is binding,
// its sentence is APPENDED after the driver sentence — never substituted in its place. The SPECIES_DEFAULT
// reason added below follows the exact same rule: it is a SECOND independent fact (what the estimate rests
// on, vs. what the owner can do about it), appended as its own sentence, never substituted for the driver
// sentence.
//
// `repotDriver` is now a CLASS over a THREE-estimator blend (`SUBSTRATE | EVIDENCE | SPECIES_DEFAULT`).
// `CROWDING` is gone: it used to be the ELSE branch of "did the substrate win?", so it meant "not
// substrate" and never consulted whether a crowding index existed at all — and the channel it actually
// named is a three-estimator blend, so naming just one of them could never have been honest (spec §2.2).
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
const DRIVER_KEY = {
  SUBSTRATE: 'taskInfo.substrate.repotDriverSubstrate',
  EVIDENCE: 'taskInfo.substrate.repotDriverEvidence',
  SPECIES_DEFAULT: 'taskInfo.substrate.repotDriverSpeciesDefault',
} as const;

const REASON_FIELD_KEY = {
  heightCm: 'taskInfo.substrate.repotReasonFieldHeightCm',
  potSizeCm: 'taskInfo.substrate.repotReasonFieldPotSizeCm',
  growthHabit: 'taskInfo.substrate.repotReasonFieldGrowthHabit',
} as const;

export function repotExplanation(
  substrate: PlantCare['substrate'] | null | undefined,
  t: (key: string, named?: Record<string, unknown>) => string,
): string | undefined {
  if (!substrate || !substrate.repotDriver) return undefined;
  const parts: string[] = [t(DRIVER_KEY[substrate.repotDriver])];

  // A2's actionable detail, APPENDED as its own sentence — the same "independent fact, never a
  // substitution" rule the override sentence below already follows. Gated on the DRIVER, not on the
  // field's presence: a reason beside EVIDENCE would be explaining something that did not happen.
  const reason = substrate.repotDriver === 'SPECIES_DEFAULT' ? substrate.repotDriverReason : null;
  if (reason) {
    if (reason.kind === 'NOT_APPLICABLE') parts.push(t('taskInfo.substrate.repotReasonNotApplicable'));
    else if (reason.kind === 'STALE') parts.push(t('taskInfo.substrate.repotReasonStale'));
    else if (reason.missing.length > 0) {
      // Translated field names, never the wire identifiers — `heightCm` is not something to show a human.
      const fields = reason.missing.map((f) => t(REASON_FIELD_KEY[f])).join(', ');
      parts.push(t('taskInfo.substrate.repotReasonMissing', { fields }));
    }
  }

  if (substrate.repotOverrideBinding) {
    parts.push(
      substrate.repotOverrideOrigin === 'OWNER'
        ? t('taskInfo.substrate.repotOverrideOwner')
        : substrate.repotOverrideOrigin === 'EVALUATION'
          ? t('taskInfo.substrate.repotOverrideEvaluation')
          : t('taskInfo.substrate.repotOverrideMoved'),
    );
  }
  return parts.join(' ');
}
