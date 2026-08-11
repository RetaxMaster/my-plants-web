// The WATER row's two survey rules, in ONE place, because TWO renderers apply them: the Today list
// (`pages/index.vue`) and the plant page (`components/PlantDetail.vue`). Parallel per-surface copies of one
// rule are this workspace's named highest-yield bug class, and both of these rules had already drifted into
// half-implementations before they were extracted here.
//
// Neither function touches Vue, the API, or i18n: they take the three facts the caller already holds and
// return a decision, so a test can pin the RULE without mounting a page.
import type { WaterPostponeReason } from '@retaxmaster/my-plants-species-schema/feedback-reason-constants';
import type { TaskCode } from './tasks.js';

/**
 * What a post-survey Posponer sends (spec §5.4). Named, never re-typed as a literal at the two call sites,
 * and `satisfies`-checked against the shared vocabulary so a typo cannot reach the API as an unknown slug.
 *
 * It says "I ran out of day", which is why it is the honest one here: it moves the date and deliberately
 * does NOT move the cadence.
 */
export const SURVEYED_POSTPONE_REASON = 'no-time' satisfies WaterPostponeReason;

/**
 * What today's soil reading SAID, as the API reports it (`measurement.todaysVerdict` on the plant care
 * payload, `todaysVerdict` on the Today WATER row). `null` means nothing was measured today.
 *
 * `'NONE'` is a real, distinguishable answer — "this reading decided nothing" — not a missing one. It is
 * what a voluntary "Agregar lectura" writes, and what a survey writes when no calibration could interpret
 * the raw value.
 */
export type TodaysVerdict = 'WATER_NOW' | 'POSTPONE' | 'NONE' | null;

/**
 * ⚠️ THE ONE PLACE THE VERDICT DECIDES WHETHER THE SURVEY CONTROL STAYS ON OFFER.
 *
 * Every case is listed here, once, as an exhaustive switch — never as a condition spread across
 * `PlantDetail.vue`, `pages/index.vue` and this file. A change to how any single verdict behaves is a
 * change to exactly one arm of this switch, and TypeScript's exhaustiveness makes a newly added verdict a
 * compile error rather than a silent fall-through.
 *
 * The owner's rule (2026-08-10): the modal's job is to ANSWER "should I water?", so once it has answered,
 * the survey control is replaced by the CONSEQUENCE of that answer rather than by nothing.
 */
export function todaysVerdictClosesSurvey(verdict: TodaysVerdict): boolean {
  switch (verdict) {
    case null:
      // Nothing measured today — the question is still open, so it is still asked.
      return false;
    case 'POSTPONE':
      // "Don't water yet." The reading already auto-postponed the watering task, so the row's own due date
      // has moved and the card has left the Today list entirely. Re-offering the survey would be asking a
      // question the app has already answered and acted on.
      return true;
    case 'WATER_NOW':
      // "Water it now." The verdict was delivered in the modal; what the row needs next is the ordinary
      // pair of task actions, Hecho | Posponer, which is exactly what TaskRow renders when `canSurvey` is
      // false. Reusing those controls, never a parallel pair built here.
      return true;
    case 'NONE':
      // ⚠️ SINGLE SEAM, OWNED BY A FOLLOW-UP TASK. A reading that decided nothing — the voluntary
      // "Agregar lectura" path, including a raw value no calibration could interpret. Today it closes the
      // survey exactly as every other reading does, which is the behaviour shipped before this fix and is
      // deliberately left untouched here. A follow-up owns this branch; when it lands, THIS ARM is the
      // whole change — nothing else in the app reads the verdict to make this decision.
      return NONE_VERDICT_CLOSES_SURVEY;
  }
}

/** See the `'NONE'` arm of `todaysVerdictClosesSurvey`. Named so the follow-up has an obvious target. */
export const NONE_VERDICT_CLOSES_SURVEY = true;

/**
 * Whether THIS plant's WATER row may offer the "¿Necesitas regar?" survey.
 *
 * Three conditions, all necessary:
 *  - `hasInstrument` — spec §5.2: an owner who selected no instrument has no way to satisfy a survey, so
 *    the row keeps today's Hecho | Posponer shape. Declining to measure is a supported choice.
 *  - `todaysVerdict` — what today's reading, if any, ANSWERED. ⚠️ THIS USED TO BE THE BARE FACT
 *    `measuredToday`, and QA measured the consequence 3/3 on three plants (finding F1, 2026-08-10): any
 *    reading dated today made the button vanish from the plant page AND the Today card, with no message,
 *    no verdict and no way back — readings carry no edit or delete affordance, so there was no undo. The
 *    flag itself was not wrong, it was the wrong QUESTION to ask: it reports that a measurement happened,
 *    and what the row needs to know is what that measurement DECIDED. The decision now lives in
 *    `todaysVerdictClosesSurvey` above, in one exhaustive switch.
 *  - `catalogueAvailable` — ⚠️ THE FAILURE DIRECTION OF THE SAME §5.2 INVARIANT, and the reason this
 *    function exists rather than a two-term `&&` in each renderer. The survey modal needs the plant's
 *    instrument catalogue (`getSoilReadings`), and a FAILED fetch is NOT an empty catalogue: opening the
 *    modal on the empty shape tells an owner who DOES own instruments that he owns none, sends him to
 *    Settings where he sees them, and returns him to the same screen — with Hecho and Posponer still
 *    withheld, because the row's own gate never knew the fetch had failed. A due watering became
 *    uncompletable over an infrastructure fault. So a catalogue we do not hold closes the survey and hands
 *    the classic row back; the caller surfaces a retryable error saying exactly that, and never the
 *    "you have no instruments" copy, which for this owner is a false statement.
 */
export function canOfferWaterSurvey(facts: {
  hasInstrument: boolean;
  todaysVerdict: TodaysVerdict;
  catalogueAvailable: boolean;
}): boolean {
  return (
    facts.hasInstrument
    && !todaysVerdictClosesSurvey(facts.todaysVerdict)
    && facts.catalogueAvailable
  );
}

/**
 * The reason a Posponer sends WITHOUT asking, or `null` when the owner must still be asked (spec §5.4:
 * "Postpone stops asking the owner for a reason. After a survey there is nothing to ask … The reason picker
 * remains only on the un-gated (no-instrument) row.").
 *
 * `measuredToday` is exactly "a reading was taken for this plant today", so a WATER postpone that follows
 * one can only mean the owner ran out of day — the soil already spoke, and it spoke through the reading.
 *
 * This is not a tap-count optimisation. The generic picker still offers `soil-still-moist`, which DOES move
 * the watering cadence; leaving it on offer after a WATER_NOW verdict lets an owner feed the adaptation loop
 * a subjective "the soil is wet" that his own measurement, taken minutes earlier, contradicts.
 */
export function postponeReasonWithoutAsking(
  task: TaskCode,
  measuredToday: boolean,
): WaterPostponeReason | null {
  if (task !== 'WATER') return null;
  return measuredToday ? SURVEYED_POSTPONE_REASON : null;
}
