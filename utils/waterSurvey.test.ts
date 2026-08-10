// The two WATER-row survey rules, pinned at the level they actually live at — one shared module, so a
// renderer that half-implements either one is a wiring bug in that renderer and not a second, silently
// different rule. The per-surface wiring is pinned in pages/index.test.ts and components/PlantDetail.test.ts.
import { describe, it, expect } from 'vitest';
import { canOfferWaterSurvey, postponeReasonWithoutAsking, SURVEYED_POSTPONE_REASON } from './waterSurvey.js';
import { WATER_POSTPONE_REASONS } from '@retaxmaster/my-plants-species-schema/feedback-reason-constants';

describe('canOfferWaterSurvey', () => {
  it('offers the survey only when the owner has an instrument, has not measured today, and we HOLD the ' +
    'catalogue', () => {
    expect(canOfferWaterSurvey({ hasInstrument: true, measuredToday: false, catalogueAvailable: true }))
      .toBe(true);
  });

  it('withholds it from an owner who selected no instrument (spec §5.2)', () => {
    expect(canOfferWaterSurvey({ hasInstrument: false, measuredToday: false, catalogueAvailable: true }))
      .toBe(false);
  });

  it('withholds it once this plant was already measured today', () => {
    expect(canOfferWaterSurvey({ hasInstrument: true, measuredToday: true, catalogueAvailable: true }))
      .toBe(false);
  });

  // THE LOAD-BEARING CASE (finding W1). The owner DOES own an instrument, so `hasInstrument` is true and
  // the row used to keep withholding Hecho/Posponer — while the modal it opened showed him the "you have no
  // instruments, go to Settings" empty state, because the catalogue fetch had failed. Both halves of that
  // are wrong, and this is the one that made a due watering uncompletable.
  it('withholds it when the catalogue fetch FAILED, even though the owner owns an instrument', () => {
    expect(canOfferWaterSurvey({ hasInstrument: true, measuredToday: false, catalogueAvailable: false }))
      .toBe(false);
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
