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
 * Whether THIS plant's WATER row may offer the "¿Necesitas regar?" survey.
 *
 * Three conditions, all necessary:
 *  - `hasInstrument` — spec §5.2: an owner who selected no instrument has no way to satisfy a survey, so
 *    the row keeps today's Hecho | Posponer shape. Declining to measure is a supported choice.
 *  - `measuredToday` — an owner who already measured this plant today has already answered the question
 *    (WATER_NOW writes its reading with `verdict: 'NONE'`), so asking again is the "asks forever" dead end.
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
  measuredToday: boolean;
  catalogueAvailable: boolean;
}): boolean {
  return facts.hasInstrument && !facts.measuredToday && facts.catalogueAvailable;
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
