// The WATER-row survey rule, pinned at the level it actually lives at — one shared module, so a
// renderer that half-implements either one is a wiring bug in that renderer and not a second, silently
// different rule. The per-surface wiring is pinned in pages/index.test.ts and components/PlantDetail.test.ts.
import { describe, it, expect } from 'vitest';
import { canOfferWaterSurvey } from './waterSurvey.js';

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

