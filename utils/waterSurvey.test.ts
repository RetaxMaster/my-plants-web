// The two WATER-row survey rules, pinned at the level they actually live at — one shared module, so a
// renderer that half-implements either one is a wiring bug in that renderer and not a second, silently
// different rule. The per-surface wiring is pinned in pages/index.test.ts and components/PlantDetail.test.ts.
import { describe, it, expect } from 'vitest';
import {
  canOfferWaterSurvey, effectiveTaskStatus, postponeReasonWithoutAsking, todaysVerdictClosesSurvey,
  NONE_VERDICT_CLOSES_SURVEY, SURVEYED_POSTPONE_REASON, storedVerdictFor,
  type TodaysVerdict,
} from './waterSurvey.js';
import { WATER_POSTPONE_REASONS } from '@retaxmaster/my-plants-species-schema/feedback-reason-constants';

describe('canOfferWaterSurvey', () => {
  // REWRITTEN 2026-08-11 (QA round 3, F1b): every case in this block now states `wateredToday` too, because
  // the rule gained a fourth necessary condition. The five pre-existing cases keep their exact meaning —
  // they describe a plant nobody has watered today, which is what they always described implicitly.
  it('offers the survey only when the owner has an instrument, today\'s question is unanswered, we HOLD ' +
    'the catalogue, and the pot has not been watered today', () => {
    expect(canOfferWaterSurvey({
      hasInstrument: true, todaysVerdict: null, catalogueAvailable: true, wateredToday: false,
    })).toBe(true);
  });

  it('withholds it from an owner who selected no instrument (spec §5.2)', () => {
    expect(canOfferWaterSurvey({
      hasInstrument: false, todaysVerdict: null, catalogueAvailable: true, wateredToday: false,
    })).toBe(false);
  });

  // REWRITTEN by QA finding F1 (2026-08-10). It used to read `measuredToday: true` — the bare FACT of a
  // reading. The fact is not the question: what closes the survey is what the reading ANSWERED, and that
  // decision now lives in `todaysVerdictClosesSurvey`, whose own cases are pinned below.
  it('withholds it once today\'s reading has answered the question', () => {
    expect(canOfferWaterSurvey({
      hasInstrument: true, todaysVerdict: 'POSTPONE', catalogueAvailable: true, wateredToday: false,
    })).toBe(false);
  });

  // THE LOAD-BEARING CASE (finding W1). The owner DOES own an instrument, so `hasInstrument` is true and
  // the row used to keep withholding Hecho/Posponer — while the modal it opened showed him the "you have no
  // instruments, go to Settings" empty state, because the catalogue fetch had failed. Both halves of that
  // are wrong, and this is the one that made a due watering uncompletable.
  it('withholds it when the catalogue fetch FAILED, even though the owner owns an instrument', () => {
    expect(canOfferWaterSurvey({
      hasInstrument: true, todaysVerdict: null, catalogueAvailable: false, wateredToday: false,
    })).toBe(false);
  });

  // ⚠️ QA round 3, F1b (owner-ruled 2026-08-11) — THE CASE NO OTHER TERM CAN COVER. Nothing was measured,
  // so `todaysVerdict` is null and every other condition is satisfied: this is the owner who simply pressed
  // Hecho on the row. Offering Medir here can only end in a write the API's one-WATER-DONE-per-day dedup
  // discards — a 200 that records nothing. Dropping `&& !facts.wateredToday` makes this go RED; inverting
  // it to `&& facts.wateredToday` makes the very first case above go RED. Both directions pinned.
  it('withholds it once the pot has been watered today, even with nothing measured', () => {
    expect(canOfferWaterSurvey({
      hasInstrument: true, todaysVerdict: null, catalogueAvailable: true, wateredToday: true,
    })).toBe(false);
  });

  // The four facts are independently necessary, and this is the assertion that pins the CONJUNCTION
  // rather than four separate one-at-a-time cases: swapping any `&&` for an `||` flips at least one row.
  it.each([
    // hasInstrument, todaysVerdict, catalogueAvailable, wateredToday, offered
    [true, null, true, false, true],
    [false, null, true, false, false],
    [true, 'POSTPONE', true, false, false],
    [true, null, false, false, false],
    [true, null, true, true, false],
    [false, 'POSTPONE', false, true, false],
    // A watered pot whose reading decided NOTHING: the two "still open" terms are both satisfied
    // (`'NONE'` keeps the question open by design), so only `wateredToday` can withhold it here.
    [true, 'NONE', true, true, false],
  ] as [boolean, TodaysVerdict, boolean, boolean, boolean][])(
    'hasInstrument=%s verdict=%s catalogue=%s watered=%s -> %s',
    (hasInstrument, todaysVerdict, catalogueAvailable, wateredToday, offered) => {
      expect(canOfferWaterSurvey({ hasInstrument, todaysVerdict, catalogueAvailable, wateredToday }))
        .toBe(offered);
    },
  );

  // ⚠️ THE TWO FACTS ARE INDEPENDENT, AND THIS IS WHAT SAYS SO. `wateredToday` is not derivable from
  // `todaysVerdict` in EITHER direction: a watering with nothing measured leaves the verdict null (row 1),
  // and a reading that says "water it now" says nothing about whether the owner then did (row 2, where the
  // verdict is what withholds the survey and the watering is irrelevant). Collapsing them into one term is
  // the conflation both the API's doc comment and this module's forbid.
  it('never lets one of the two facts stand in for the other', () => {
    const base = { hasInstrument: true, catalogueAvailable: true } as const;
    expect(canOfferWaterSurvey({ ...base, todaysVerdict: null, wateredToday: true })).toBe(false);
    expect(canOfferWaterSurvey({ ...base, todaysVerdict: 'WATER_NOW', wateredToday: false })).toBe(false);
    // …and the ONE combination that still offers it: nothing decided, nothing watered.
    expect(canOfferWaterSurvey({ ...base, todaysVerdict: 'NONE', wateredToday: false })).toBe(true);
  });
});

// ⚠️ THE ONE PLACE THE VERDICT DECIDES, so this is where each verdict's behaviour is pinned — never
// re-asserted inside a renderer's own test, which is how the rule would come to have two definitions.
describe('todaysVerdictClosesSurvey', () => {
  it('keeps the question open when nothing was measured today', () => {
    expect(todaysVerdictClosesSurvey(null)).toBe(false);
  });

  // "Don't water yet": the reading auto-postponed the task, so the card has already left Today and the
  // plant page's row carries the moved date. Asking again would re-ask a question already acted on.
  it('closes it on a POSTPONE verdict', () => {
    expect(todaysVerdictClosesSurvey('POSTPONE')).toBe(true);
  });

  // "Water it now": the answer was delivered in the modal, and what the row shows next is the ordinary
  // Hecho | Posponer pair TaskRow renders when `canSurvey` is false — the existing controls, not a new pair.
  it('closes it on a WATER_NOW verdict', () => {
    expect(todaysVerdictClosesSurvey('WATER_NOW')).toBe(true);
  });

  // REWRITTEN (owner-ruled 2026-08-11). The retired case was
  // `'closes it on a NONE verdict — today's behaviour, and the single seam a follow-up owns'`, and it
  // pinned the shipped behaviour on purpose while the follow-up it names was still outstanding. THE DEFECT
  // that behaviour caused, and which the follow-up has now landed: logging a raw weight in the morning
  // removed the survey for the rest of the day — the owner stored his own measurement, got no verdict, and
  // lost the only control that could give him one, with no edit or delete affordance to undo it.
  //
  // A reading that decided nothing (the voluntary "Agregar lectura" path, and a raw value no calibration
  // could interpret) answers nothing, so it closes nothing.
  it('KEEPS the question open on a NONE verdict — a reading that decided nothing answered nothing', () => {
    expect(todaysVerdictClosesSurvey('NONE')).toBe(false);
  });

  // The constant is exported so the arm above has an obvious, named target. Pinned against the FUNCTION's
  // own answer rather than as a second copy of the literal, so the two can never disagree.
  it('exposes that decision as NONE_VERDICT_CLOSES_SURVEY', () => {
    expect(NONE_VERDICT_CLOSES_SURVEY).toBe(false);
    expect(todaysVerdictClosesSurvey('NONE')).toBe(NONE_VERDICT_CLOSES_SURVEY);
  });
});

describe('postponeReasonWithoutAsking', () => {
  // Spec §5.4: after a survey there is nothing to ask — either the soil said wait, or the owner ran out of
  // day. A measured WATER postpone is the second one, and it says so with `no-time`.
  it('sends no-time for a WATER postpone that follows today\'s measurement', () => {
    expect(postponeReasonWithoutAsking('WATER', true)).toBe('no-time');
  });

  it('still asks on the un-gated WATER row — nothing was measured, so the reason is the only signal', () => {
    expect(postponeReasonWithoutAsking('WATER', false)).toBeNull();
  });

  // The reason vocabulary is WATER-only (the shared contract's own header): no other task carries one, so a
  // measured flag on a REPOT/FERTILIZE row must never invent one.
  it('never invents a reason for a non-WATER task, measured or not', () => {
    expect(postponeReasonWithoutAsking('REPOT', true)).toBeNull();
    expect(postponeReasonWithoutAsking('FERTILIZE', true)).toBeNull();
    expect(postponeReasonWithoutAsking('MIST', false)).toBeNull();
  });

  // The slug is persisted verbatim into CareEvent.payload and validated server-side against this exact
  // vocabulary — pinned against the SHARED array rather than against a second copy of the string, so a
  // rename upstream fails here instead of at runtime.
  it('sends a slug the shared WATER vocabulary actually contains', () => {
    expect(WATER_POSTPONE_REASONS).toContain(SURVEYED_POSTPONE_REASON);
  });

  // …and specifically NOT one of the two that move the cadence. `soil-still-moist` is the justified
  // postpone reason (it shortens/lengthens the watering interval); a measured postpone must never claim it.
  it('never sends the cadence-moving reason', () => {
    expect(SURVEYED_POSTPONE_REASON).not.toBe('soil-still-moist');
  });
});

// ---- QA 2026-08-11, finding 3 (owner-ruled; docs/care-engine.md §7.20.15) -----------------------------
//
// "The schedule was a prediction, the measurement is the observation. Measuring so that the prediction
// still wins defeats the point of measuring." A `WATER_NOW` verdict makes the watering read as due TODAY.
//
// Pinned HERE, at the rule, because three consumers apply it: TaskRow (badge + Posponer), and both pages
// (the status they hand `onDone`, which decides whether the early-watering reason picker opens). A local
// copy in any of the three is how the app would tell the owner to water now and then ask him, one tap
// later, why he is watering early.
describe('effectiveTaskStatus', () => {
  // REWRITTEN 2026-08-11 (QA round 3, HIGH): every case now states `promptAnsweredToday` too. The five
  // pre-existing cases keep their exact meaning — an UNANSWERED day is what they always described.
  it('promotes an upcoming WATER row to today when the measurement says WATER_NOW', () => {
    expect(effectiveTaskStatus('WATER', 'WATER_NOW', 'upcoming', false)).toBe('today');
  });

  // The two verdicts that must change nothing, wrong in opposite directions: POSTPONE is the instruction to
  // leave the task alone (it already moved its own date), NONE decided nothing, and null means nothing was
  // measured at all.
  it.each([['POSTPONE'], ['NONE'], [null]] as [TodaysVerdict][])(
    'leaves an upcoming row alone on a %s verdict', (verdict) => {
      expect(effectiveTaskStatus('WATER', verdict, 'upcoming', false)).toBe('upcoming');
    });

  // Scoped to `upcoming`: an already-due or overdue row is not "promoted" — its own status is at least as
  // urgent and strictly more accurate, and rewriting `overdue` to `today` would LOSE information.
  it('never rewrites a row that is already due or overdue', () => {
    expect(effectiveTaskStatus('WATER', 'WATER_NOW', 'today', false)).toBe('today');
    expect(effectiveTaskStatus('WATER', 'WATER_NOW', 'overdue', false)).toBe('overdue');
  });

  // A soil verdict speaks for the WATER task and for nothing else. Passing it alongside another task is not
  // a shape the app produces, but the rule must be inert on it rather than incidentally correct.
  it('never touches a non-WATER task, whatever verdict travels with it', () => {
    expect(effectiveTaskStatus('REPOT', 'WATER_NOW', 'upcoming', false)).toBe('upcoming');
    expect(effectiveTaskStatus('FERTILIZE', 'WATER_NOW', 'upcoming', false)).toBe('upcoming');
  });

  // ---- QA round 3, HIGH (2026-08-11): THE PROMOTION'S EXIT --------------------------------------------
  //
  // A verdict is a stored fact and nothing retracts it, so the rule above had no way to END: press Hecho on
  // the measured card and it came back byte-identical — "Riega ahora", both buttons — across a full reload.
  // `promptAnsweredToday` is what retires it. Dropping `&& !promptAnsweredToday` makes the case below RED;
  // inverting it to `&& promptAnsweredToday` makes the very first case in this block RED. Both directions.
  it('stands the promotion down once today\'s reading has been ANSWERED', () => {
    expect(effectiveTaskStatus('WATER', 'WATER_NOW', 'upcoming', true)).toBe('upcoming');
  });

  // The exit is not a general mute: an ANSWERED day leaves a genuinely due or overdue row exactly as the
  // calendar reports it. (Guards against "answered" being folded into the status rather than into the
  // promotion — a mutation that returns `'upcoming'` whenever `promptAnsweredToday` holds turns these red.)
  it('changes nothing about a row the calendar itself already made due', () => {
    expect(effectiveTaskStatus('WATER', 'WATER_NOW', 'today', true)).toBe('today');
    expect(effectiveTaskStatus('WATER', 'WATER_NOW', 'overdue', true)).toBe('overdue');
    expect(effectiveTaskStatus('WATER', null, 'overdue', true)).toBe('overdue');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════
// MOVED 2026-08-11 (code review) — the whole `describe('verdictIsAnswer')`, two cases: `counts a real
// decision as an answer` and `counts "nothing decided" as the ABSENCE of an answer, never one of them`.
//
// They are not retracted and the behaviour they pinned is unchanged: the FUNCTION left this repo. It was
// this file's own copy of a rule the API also owned, and the two now live once, in
// `my-plants-species-schema/src/soil-reading.test.ts`, which pins those two cases plus two the fork never
// had (the whole vocabulary derived from `READING_VERDICTS`, and an unrecognised verdict classified as an
// ANSWER rather than as the absence of one).
//
// ⚠️ AND ONE CLAIM IN THE RETIRED COMMENT WAS SIMPLY FALSE, which is worth recording rather than deleting:
// it said *"these three cases are the same three the API's `todays-reading.test.ts` pins, so a divergence
// is a red suite on one side"*. There were two cases, not three, and the API's file never named that
// function at all — nothing on either side would have gone red. A convention two suites are supposed to
// hold each other to, asserted only in a comment, is the reason the hoist was worth doing.
//
// What still belongs to THIS file is the warning that survived the move: `verdictIsAnswer` is NOT
// `todaysVerdictClosesSurvey` with the null arm removed. See `utils/waterSurvey.ts`' own note.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════

describe('storedVerdictFor', () => {
  // The mapping the survey and the voluntary edit now SHARE. It has already moved once under its callers:
  // a WATER_NOW recommendation was stored as `'NONE'` until 2026-08-11, because a stored `'WATER_NOW'` made
  // the API fabricate a watering. Pinning all three arms is what makes a second move visible.
  it('stores a WATER_NOW recommendation as the verdict it actually reached', () => {
    expect(storedVerdictFor('WATER_NOW')).toBe('WATER_NOW');
  });

  // ⚠️ THE ONE ARM THAT MOVES A SCHEDULE. `HOLD` is the recommendation; `POSTPONE` is the stored verdict,
  // and it is the value the API's retraction rule is keyed on ("the row used to say POSTPONE and no longer
  // does"). Mutating this arm to `'NONE'` makes the edit path decide nothing and the deferral stand — the
  // defect §7.20.17 exists to remove; mutating it to `'WATER_NOW'` inverts a hold into its opposite.
  it('stores a HOLD recommendation as POSTPONE', () => {
    expect(storedVerdictFor('HOLD')).toBe('POSTPONE');
  });

  // No honest fraction exists, so nothing was decided. Mutating this arm to either answer would make an
  // uninterpretable reading silently supersede the answer already on the row.
  it('stores an UNAVAILABLE recommendation as the non-answer NONE', () => {
    expect(storedVerdictFor('UNAVAILABLE')).toBe('NONE');
  });
});
