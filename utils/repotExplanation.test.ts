import { describe, expect, it } from 'vitest';
import { repotExplanation } from './repotExplanation.js';

// A fake translator returning a distinctive marker per key, so assertions pin the ORDER and the
// SEPARATOR of the composition — never the actual prose (which lives in the locale files).
const t = (key: string) => `[${key}]`;

describe('repotExplanation', () => {
  it('returns undefined when there is no substrate block', () => {
    expect(repotExplanation(undefined, t)).toBeUndefined();
    expect(repotExplanation(null, t)).toBeUndefined();
  });

  it('returns undefined when the substrate block has no repotDriver', () => {
    expect(
      repotExplanation(
        { repotDriver: null, repotOverrideBinding: false } as any,
        t,
      ),
    ).toBeUndefined();
  });

  it('returns only the driver sentence for a SUBSTRATE driver with no binding override', () => {
    expect(
      repotExplanation({ repotDriver: 'SUBSTRATE', repotOverrideBinding: false } as any, t),
    ).toBe('[taskInfo.substrate.repotDriverSubstrate]');
  });

  it('returns only the driver sentence for a CROWDING driver with no binding override', () => {
    expect(
      repotExplanation({ repotDriver: 'CROWDING', repotOverrideBinding: false } as any, t),
    ).toBe('[taskInfo.substrate.repotDriverCrowding]');
  });

  it('appends the override sentence after the SUBSTRATE driver sentence, single-space joined', () => {
    expect(
      repotExplanation(
        { repotDriver: 'SUBSTRATE', repotOverrideBinding: true, repotOverrideOrigin: 'OWNER' } as any,
        t,
      ),
    ).toBe('[taskInfo.substrate.repotDriverSubstrate] [taskInfo.substrate.repotOverrideOwner]');
  });

  it('appends the override sentence after the CROWDING driver sentence, single-space joined', () => {
    expect(
      repotExplanation(
        { repotDriver: 'CROWDING', repotOverrideBinding: true, repotOverrideOrigin: 'OWNER' } as any,
        t,
      ),
    ).toBe('[taskInfo.substrate.repotDriverCrowding] [taskInfo.substrate.repotOverrideOwner]');
  });

  // ---- QA round 5, finding 1: the sentence must be true of whoever actually moved the date -------------
  //
  // One string used to serve both authors, and it named the owner. On the questionnaire path there is no
  // POSTPONED care event at all, so the app was asserting a fact no data supported — and contradicting the
  // "Already checked — we'll ask again on <date>" note rendered directly beneath it in the same row.
  describe('the override sentence is chosen by WHO moved the date', () => {
    it('names the OWNER only when the owner actually postponed it', () => {
      expect(
        repotExplanation(
          { repotDriver: 'CROWDING', repotOverrideBinding: true, repotOverrideOrigin: 'OWNER' } as any,
          t,
        ),
      ).toContain('[taskInfo.substrate.repotOverrideOwner]');
    });

    it('names the EVALUATION when the questionnaire deferred it — never the owner', () => {
      const out = repotExplanation(
        { repotDriver: 'CROWDING', repotOverrideBinding: true, repotOverrideOrigin: 'EVALUATION' } as any,
        t,
      );
      expect(out).toBe('[taskInfo.substrate.repotDriverCrowding] [taskInfo.substrate.repotOverrideEvaluation]');
      expect(out).not.toContain('repotOverrideOwner');
    });

    it('falls back to the author-neutral sentence when the origin is absent or null — never to the owner one', () => {
      // An older API (or a future writer that forgets to stamp an origin). Saying "the date moved" is true
      // of both authors; re-asserting "you postponed this" would reinstate the exact defect.
      for (const substrate of [
        { repotDriver: 'CROWDING', repotOverrideBinding: true },
        { repotDriver: 'CROWDING', repotOverrideBinding: true, repotOverrideOrigin: null },
      ]) {
        const out = repotExplanation(substrate as any, t);
        expect(out).toBe('[taskInfo.substrate.repotDriverCrowding] [taskInfo.substrate.repotOverrideMoved]');
        expect(out).not.toContain('repotOverrideOwner');
      }
    });

    it('says nothing about an author when nothing is binding, whatever the origin field holds', () => {
      expect(
        repotExplanation(
          { repotDriver: 'SUBSTRATE', repotOverrideBinding: false, repotOverrideOrigin: 'EVALUATION' } as any,
          t,
        ),
      ).toBe('[taskInfo.substrate.repotDriverSubstrate]');
    });
  });
});
