// The two WATER-row survey rules, pinned at the level they actually live at — one shared module, so a
// renderer that half-implements either one is a wiring bug in that renderer and not a second, silently
// different rule. The per-surface wiring is pinned in pages/index.test.ts and components/PlantDetail.test.ts.
import { describe, it, expect } from 'vitest';
import {
  canOfferWaterSurvey, postponeReasonWithoutAsking, todaysVerdictClosesSurvey,
  SURVEYED_POSTPONE_REASON, type TodaysVerdict,
} from './waterSurvey.js';
import { WATER_POSTPONE_REASONS } from '@retaxmaster/my-plants-species-schema/feedback-reason-constants';

describe('canOfferWaterSurvey', () => {
  it('offers the survey only when the owner has an instrument, today\'s question is unanswered, and we ' +
    'HOLD the catalogue', () => {
    expect(canOfferWaterSurvey({ hasInstrument: true, todaysVerdict: null, catalogueAvailable: true }))
      .toBe(true);
  });

  it('withholds it from an owner who selected no instrument (spec §5.2)', () => {
    expect(canOfferWaterSurvey({ hasInstrument: false, todaysVerdict: null, catalogueAvailable: true }))
      .toBe(false);
  });

  // REWRITTEN by QA finding F1 (2026-08-10). It used to read `measuredToday: true` — the bare FACT of a
  // reading. The fact is not the question: what closes the survey is what the reading ANSWERED, and that
  // decision now lives in `todaysVerdictClosesSurvey`, whose own cases are pinned below.
  it('withholds it once today\'s reading has answered the question', () => {
    expect(canOfferWaterSurvey({ hasInstrument: true, todaysVerdict: 'POSTPONE', catalogueAvailable: true }))
      .toBe(false);
  });

  // THE LOAD-BEARING CASE (finding W1). The owner DOES own an instrument, so `hasInstrument` is true and
  // the row used to keep withholding Hecho/Posponer — while the modal it opened showed him the "you have no
  // instruments, go to Settings" empty state, because the catalogue fetch had failed. Both halves of that
  // are wrong, and this is the one that made a due watering uncompletable.
  it('withholds it when the catalogue fetch FAILED, even though the owner owns an instrument', () => {
    expect(canOfferWaterSurvey({ hasInstrument: true, todaysVerdict: null, catalogueAvailable: false }))
      .toBe(false);
  });

  // The three facts are independently necessary, and this is the assertion that pins the CONJUNCTION
  // rather than three separate one-at-a-time cases: swapping any `&&` for an `||` flips at least one row.
  it.each([
    // hasInstrument, todaysVerdict, catalogueAvailable, offered
    [true, null, true, true],
    [false, null, true, false],
    [true, 'POSTPONE', true, false],
    [true, null, false, false],
    [false, 'POSTPONE', false, false],
  ] as [boolean, TodaysVerdict, boolean, boolean][])(
    'hasInstrument=%s verdict=%s catalogue=%s -> %s',
    (hasInstrument, todaysVerdict, catalogueAvailable, offered) => {
      expect(canOfferWaterSurvey({ hasInstrument, todaysVerdict, catalogueAvailable })).toBe(offered);
    },
  );
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

  // A reading that decided nothing (the voluntary "Agregar lectura" path, including a raw value no
  // calibration could interpret). Pinned at TODAY'S shipped behaviour, unchanged by finding F1's fix. A
  // follow-up owns this branch; when it lands, this expectation is what it flips, and it is the only one.
  it('closes it on a NONE verdict — today\'s behaviour, and the single seam a follow-up owns', () => {
    expect(todaysVerdictClosesSurvey('NONE')).toBe(true);
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
