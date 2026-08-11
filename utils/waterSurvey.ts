// The WATER row's two survey rules, in ONE place, because TWO renderers apply them: the Today list
// (`pages/index.vue`) and the plant page (`components/PlantDetail.vue`). Parallel per-surface copies of one
// rule are this workspace's named highest-yield bug class, and both of these rules had already drifted into
// half-implementations before they were extracted here.
//
// Neither function touches Vue, the API, or i18n: they take the three facts the caller already holds and
// return a decision, so a test can pin the RULE without mounting a page.
import type { WaterPostponeReason } from '@retaxmaster/my-plants-species-schema/feedback-reason-constants';
import type { Recommendation } from '@retaxmaster/my-plants-species-schema/watering-verdict-constants';
import type { ReadingVerdict } from '@retaxmaster/my-plants-species-schema';
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
 * ⚠️ `verdictIsAnswer` USED TO BE DEFINED IN THIS FILE, AND IT IS NOW IMPORTED FROM THE SHARED CONTRACT
 * (hoisted 2026-08-11, code review). It was written here as *"the web's half of a definition the API
 * owns"*, with a comment naming `my-plants-api/src/soil-readings/todays-reading.ts` as the real one — an
 * honest fork is still a fork, and this workspace names parallel copies of one rule across two runtimes as
 * its highest-yield bug class. The rule now lives once, in `@retaxmaster/my-plants-species-schema`, beside
 * the `READING_VERDICTS` vocabulary it derives from; both API call sites and this repo import it from
 * there, so a change to what counts as an answer cannot reach one runtime and miss the other.
 *
 * It is re-stated here as a POINTER rather than a re-export, deliberately: a re-export would let call sites
 * go on importing "the web's `verdictIsAnswer`", which is the fork surviving its own deletion. The one
 * consumer in this repo (`SoilReadingModal.vue`) imports it straight from the package.
 *
 * ⚠️ AND IT IS STILL NOT `todaysVerdictClosesSurvey` WITH THE NULL ARM REMOVED, however identical the two
 * look on today's three verdicts. That one answers *"should the survey control be withdrawn?"*; the shared
 * one answers *"did this reading decide anything?"*. They agree by coincidence, not by construction — a
 * future verdict could easily be an answer that nonetheless leaves the survey on offer — and collapsing
 * them would make one function silently responsible for two rulings. That warning belongs HERE, next to
 * the function it is about, which is why it did not travel to the shared package with the predicate.
 */

/**
 * WHAT A PREVIEW'S RECOMMENDATION IS STORED AS — the ONE translation from the read-only verdict endpoint's
 * vocabulary (`WATER_NOW` / `HOLD` / `UNAVAILABLE`) into the reading row's own (`WATER_NOW` / `POSTPONE` /
 * `'NONE'`).
 *
 * ⚠️ IT EXISTS BECAUSE THIS MAPPING NOW HAS MORE THAN ONE CALLER, and it has already changed once under
 * them. Until 2026-08-11 a `WATER_NOW` recommendation was stored as `'NONE'` — a workaround for an API that
 * turned a stored `'WATER_NOW'` into a WATER **DONE** care event, i.e. a watering the owner had not
 * performed. When the API's care-event write was narrowed to `'POSTPONE'` only, this mapping moved. A
 * second copy of it, in the edit path that re-derives a verdict for a corrected reading, would be a copy
 * that can be silently wrong while looking right.
 *
 * An exhaustive `switch` rather than a lookup object, so a fourth recommendation is a COMPILE error here
 * instead of an `undefined` verdict travelling to the API.
 */
export function storedVerdictFor(recommendation: Recommendation): ReadingVerdict {
  switch (recommendation) {
    case 'WATER_NOW':
      // "Water it now." Advice, never an act — the API records no watering for it (that ruling is what
      // made storing the honest verdict safe at all).
      return 'WATER_NOW';
    case 'HOLD':
      // "Don't water yet." The one verdict that moves the schedule: it is stored as `POSTPONE` and must
      // travel with the preview's own `suggestedPostponeToOn`, or the shared schema refuses the write.
      return 'POSTPONE';
    case 'UNAVAILABLE':
      // No honest fraction exists, so no question was answered. The reading is still the owner's data and
      // is still stored — it simply decides nothing, which is exactly what `'NONE'` means.
      return 'NONE';
  }
}

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
      //
      // ⚠️ REACHABLE SINCE 2026-08-11, AND THAT IS WHAT LET THE `'NONE'` ARM BELOW BE FIXED. Until then the
      // survey stored `'NONE'` for a water-now answer, because a stored `'WATER_NOW'` made the API write a
      // WATER **DONE** care event — fabricating a watering the owner had not performed. The API's
      // care-event write is now narrowed to `'POSTPONE'` only (`soil-reading.write-core.ts`), so the survey
      // stores the verdict it actually reached and this arm carries exactly the case its name says.
      return true;
    case 'NONE':
      // A reading that ANSWERED NOTHING — the voluntary "Agregar lectura" path, and a survey whose raw
      // value no calibration could interpret. The survey control STAYS: the owner's question has not been
      // asked, let alone answered, so withdrawing the only control that can answer it would be the app
      // taking a measurement as a reply to a question it never put.
      //
      // ⚠️ THIS ARM RETURNED `true` UNTIL 2026-08-11, AND THE DEFECT IT CAUSED IS THE REASON THE WHOLE
      // ONE-READING-PER-DAY RULING EXISTS. Logging a raw scale weight in the morning removed the survey for
      // the rest of the day: the owner stored his own measurement, got no verdict, and lost the only way to
      // ask for one — with no edit or delete affordance on the reading, so no way back either.
      //
      // ⚠️ WHY IT COULD NOT SIMPLY BE FLIPPED BEFORE. `'NONE'` used to carry TWO different cases, because a
      // water-now survey also stored `'NONE'` (see the `'WATER_NOW'` arm above). Flipping this constant
      // alone would therefore also have stopped a water-now survey from closing the affordance — and since
      // TaskRow withholds Hecho and Posponer while the survey is on offer, the owner would have been told
      // to water and then given no way to record that he had. Separating the two stored values in the API
      // was the precondition, and it landed in the same change as this flip.
      return NONE_VERDICT_CLOSES_SURVEY;
  }
}

/**
 * See the `'NONE'` arm of `todaysVerdictClosesSurvey`. Kept as a NAMED constant rather than inlined as
 * `false`, because the name is what makes the arm's meaning legible at the one place a future change would
 * touch it: a reading that decided nothing does not close a question nobody answered.
 */
export const NONE_VERDICT_CLOSES_SURVEY = false;

/**
 * Whether THIS plant's WATER row may offer the "¿Necesitas regar?" survey.
 *
 * Four conditions, all necessary:
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
 *  - `wateredToday` — ⚠️ THE FOURTH CONDITION, AND THE ONLY ONE THAT IS NOT ABOUT A READING (QA round 3,
 *    finding F1b; owner-ruled 2026-08-11, in his own words): *after marking a Riego task as Done, the
 *    **Medir** button on the plant page must disappear; it comes back the next day — and that's fine,
 *    because the watering task already measured.* It is `watering.wateredToday` on the plant care payload:
 *    a `WATER` care event of type `DONE` dated the plant's own local today.
 *
 *    WHAT IT PREVENTS. Measuring a pot that was already watered today produced a `200` the API's
 *    one-WATER-DONE-per-day dedup then silently DISCARDED — the app accepted the action, showed no error
 *    and recorded nothing. The honest fix is to stop offering the action, never to make a discarded one
 *    look like it worked. The owner explicitly ruled the remaining edge case — measuring an
 *    already-watered pot and finding it DRY — OUT OF SCOPE: we do not support it.
 *
 *    ⚠️ IT IS NOT COVERED BY `todaysVerdict`, AND THE TWO MUST NOT BE COLLAPSED. `todaysVerdict` speaks
 *    only for days something was MEASURED; the case F1b is about is the owner who pressed Hecho on the row
 *    WITHOUT measuring first — nothing was read, so the verdict is `null`, the survey stays on offer, and
 *    the Medir it offers can only end in that discarded write. The converse is just as true: a watering
 *    says nothing about what a reading decided. Two facts, two terms, and the API keeps them in two fields
 *    for the same reason (`watering.wateredToday` vs `measurement.todaysVerdict`).
 *
 *    ⚠️ AND IT DOES NOT TOUCH THE VOLUNTARY "Agregar lectura" (owner-ruled the same day). Only the SURVEY
 *    withdraws. The free log is the one way to correct the day's reading, and since there is one reading
 *    per plant per instrument per day it EDITS today's row rather than adding a second one — so leaving it
 *    reachable after a watering is deliberate, not an oversight. See `PlantDetail.vue`'s own gate.
 */
export function canOfferWaterSurvey(facts: {
  hasInstrument: boolean;
  todaysVerdict: TodaysVerdict;
  catalogueAvailable: boolean;
  wateredToday: boolean;
}): boolean {
  return (
    facts.hasInstrument
    && !todaysVerdictClosesSurvey(facts.todaysVerdict)
    && facts.catalogueAvailable
    && !facts.wateredToday
  );
}

/** The three urgency states every task row is rendered in. Named here because `effectiveTaskStatus` below
 *  both takes and returns one, and both renderers already speak this vocabulary. */
export type TaskDueStatus = 'overdue' | 'today' | 'upcoming';

/**
 * ⚠️ THE ONE PLACE A MEASURED "WATER NOW" OVERRIDES THE CALENDAR (QA 2026-08-11, finding 3; owner-ruled;
 * docs/care-engine.md §7.20.15).
 *
 * The owner's words: the schedule was a *prediction*, the measurement is the *observation*, and measuring
 * so that the prediction still wins defeats the point of measuring. So a `WATER_NOW` verdict on today's
 * reading makes that watering task read as **due today**, wherever it is rendered.
 *
 * THE DEFECT IT CLOSES. The verdict used to evaporate the moment the dialog shut: the row still said
 * "faltan 9 días", **Posponer** did not render (it is withheld on an `upcoming` task), the survey was spent
 * for the day, and the plant reached the Today list not at all. The app said *water it now* and left no
 * trace anywhere the owner would look.
 *
 * ⚠️ IT IS A **PRESENTATION** RULE OVER A FIELD THAT ALREADY TRAVELS, NOT A RESCHEDULE. Nothing is written:
 * no care event, no feedback row, no override, no fabricated anything — the owner overturned exactly that
 * shape of fix on 2026-08-09, when a stored `WATER_NOW` used to record a watering he had not performed. The
 * API's own half is the mirror image and equally read-only (`care-plan.service.ts` SURFACES the row with
 * `nextDueOn` reported UNCHANGED); this function is what turns that surfaced row into a card the owner can
 * act on.
 *
 * ⚠️ AND IT MUST BE APPLIED TO THE HANDLERS, NOT ONLY TO THE BADGE. `TaskRow` uses it to pick the badge and
 * to un-withhold Posponer; the two pages use it for the status they hand `onDone`, which is what decides
 * whether the early-watering reason picker opens. Deriving those two from different readings of the same
 * fact is how the app would end up telling the owner to water now and then asking him why he is watering
 * early — the app second-guessing its own verdict, one tap after issuing it.
 *
 * SCOPED TO `upcoming`, exactly like `TaskRow`'s REPOT sibling: a task that is already overdue keeps its
 * overdue reading, which is the more urgent AND the more accurate of the two statements. And scoped to
 * `WATER_NOW`: `POSTPONE` is the opposite instruction (it moved its own date), `'NONE'` decided nothing,
 * and `null` means nothing was measured.
 *
 * ⚠️ AND IT HAS AN EXIT — `promptAnsweredToday` (QA round 3, HIGH, 2026-08-11). The rule above was written
 * with no way to END: a verdict is a stored fact and nothing retracts it, so pressing **Hecho** on the
 * measured card left it BYTE-IDENTICAL — still "Riega ahora", still both buttons — across a full reload,
 * and the only rational reading available to the owner was *"it didn't work"*. The Today list closed this
 * on the API side by not surfacing the row at all; the plant page has no such filter (it renders the
 * plant's own tasks and applies this rule itself), and it offers `Posponer` on a WATER row too, so both
 * ways of answering the card survived there.
 *
 * `promptAnsweredToday` is the API's own term for *"today's deciding reading has already been answered"* —
 * a `WATER` care event of type `DONE` **or** `POSTPONED`, dated the plant's local today and recorded at or
 * after the moment that reading was last STATED. Once it is true the verdict has run its course and this
 * function stands down, handing back the calendar's own status.
 *
 * ⚠️ IT IS A DIFFERENT QUESTION FROM `canOfferWaterSurvey`'s `wateredToday`, and the API keeps them as two
 * fields for exactly this reason. A **postpone** answers the day's question while watering nothing: it
 * must retire this promotion (`promptAnsweredToday`) and must NOT withdraw the Medir button
 * (`wateredToday`). One boolean cannot serve both without lying to one of the two callers.
 *
 * `false` — not a third state — when nothing was measured today: with no reading there is no verdict, so
 * nothing is promoting the row and there is nothing to suppress. `todaysVerdict === null` already
 * distinguishes "no reading" from "a reading nobody has answered yet" for any caller that cares.
 */
export function effectiveTaskStatus(
  task: TaskCode,
  todaysVerdict: TodaysVerdict,
  status: TaskDueStatus,
  promptAnsweredToday: boolean,
): TaskDueStatus {
  const measurementSaysNow = task === 'WATER' && todaysVerdict === 'WATER_NOW' && status === 'upcoming';
  return measurementSaysNow && !promptAnsweredToday ? 'today' : status;
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
