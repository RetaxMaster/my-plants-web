import { describe, expect, it } from 'vitest';
import { repotExplanation } from './repotExplanation.js';

// A fake translator returning a distinctive marker per key, so assertions pin the ORDER and the
// SEPARATOR of the composition — never the actual prose (which lives in the locale files). Named
// interpolation params are folded into the marker too, so a test can pin exactly which fields were
// translated and passed through, without asserting on the locale copy itself.
const t = (key: string, named?: Record<string, unknown>) =>
  named ? `[${key}:${JSON.stringify(named)}]` : `[${key}]`;

describe('repotExplanation', () => {
  it('returns undefined when there is no substrate block', () => {
    expect(repotExplanation(undefined, t)).toBeUndefined();
    expect(repotExplanation(null, t)).toBeUndefined();
  });

  it('returns undefined when the substrate block has no repotDriver (a pre-migration NULL row)', () => {
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

  it('renders the EVIDENCE sentence', () => {
    expect(
      repotExplanation({ repotDriver: 'EVIDENCE', repotOverrideBinding: false } as any, t),
    ).toBe('[taskInfo.substrate.repotDriverEvidence]');
  });

  it('renders the SPECIES_DEFAULT sentence, and APPENDS its reason as a second sentence', () => {
    // Two facts, two sentences: what the estimate rests on, and what the owner can do about it. The
    // reason is APPENDED, exactly as the override sentence already is — never substituted for the
    // driver sentence.
    expect(
      repotExplanation(
        {
          repotDriver: 'SPECIES_DEFAULT',
          repotDriverReason: { kind: 'NOT_APPLICABLE', missing: [] },
          repotOverrideBinding: false,
        } as any,
        t,
      ),
    ).toBe('[taskInfo.substrate.repotDriverSpeciesDefault] [taskInfo.substrate.repotReasonNotApplicable]');
  });

  it('renders the STALE reason sentence for a SPECIES_DEFAULT driver', () => {
    expect(
      repotExplanation(
        {
          repotDriver: 'SPECIES_DEFAULT',
          repotDriverReason: { kind: 'STALE', missing: [] },
          repotOverrideBinding: false,
        } as any,
        t,
      ),
    ).toBe('[taskInfo.substrate.repotDriverSpeciesDefault] [taskInfo.substrate.repotReasonStale]');
  });

  it('renders the MISSING reason with the field list, translated', () => {
    // 'heightCm' must reach the owner as "its height", never as a wire identifier.
    const out = repotExplanation(
      {
        repotDriver: 'SPECIES_DEFAULT',
        repotDriverReason: { kind: 'MISSING', missing: ['heightCm', 'potSizeCm'] },
        repotOverrideBinding: false,
      } as any,
      t,
    );
    expect(out).toBe(
      '[taskInfo.substrate.repotDriverSpeciesDefault] ' +
        '[taskInfo.substrate.repotReasonMissing:{"fields":"[taskInfo.substrate.repotReasonFieldHeightCm], [taskInfo.substrate.repotReasonFieldPotSizeCm]"}]',
    );
    expect(out).not.toContain('heightCm');
    expect(out).not.toContain('potSizeCm');
  });

  it('renders NO reason sentence for a driver that is not SPECIES_DEFAULT, even if one arrives', () => {
    // Defensive: a reason attached to EVIDENCE would explain something that did not happen. The gate is
    // the DRIVER, never the presence of the field.
    expect(
      repotExplanation(
        {
          repotDriver: 'EVIDENCE',
          repotDriverReason: { kind: 'MISSING', missing: ['heightCm'] },
          repotOverrideBinding: false,
        } as any,
        t,
      ),
    ).toBe('[taskInfo.substrate.repotDriverEvidence]');
  });

  it('still APPENDS the override sentence after the driver sentence — both facts, in order', () => {
    // The existing rule, preserved. Kept deliberately: this is the assertion that would have caught the
    // QA round this file's comment records.
    expect(
      repotExplanation(
        { repotDriver: 'SUBSTRATE', repotOverrideBinding: true, repotOverrideOrigin: 'OWNER' } as any,
        t,
      ),
    ).toBe('[taskInfo.substrate.repotDriverSubstrate] [taskInfo.substrate.repotOverrideOwner]');
  });

  it('appends the override sentence after the EVIDENCE driver sentence, single-space joined', () => {
    expect(
      repotExplanation(
        { repotDriver: 'EVIDENCE', repotOverrideBinding: true, repotOverrideOrigin: 'OWNER' } as any,
        t,
      ),
    ).toBe('[taskInfo.substrate.repotDriverEvidence] [taskInfo.substrate.repotOverrideOwner]');
  });

  it('appends the override sentence after both the SPECIES_DEFAULT driver AND its reason sentence', () => {
    // All three facts can coexist: the estimator class, why it fell back, and that a postponement binds
    // the date currently shown — each is independent, so all three are appended, in order.
    expect(
      repotExplanation(
        {
          repotDriver: 'SPECIES_DEFAULT',
          repotDriverReason: { kind: 'STALE', missing: [] },
          repotOverrideBinding: true,
          repotOverrideOrigin: 'OWNER',
        } as any,
        t,
      ),
    ).toBe(
      '[taskInfo.substrate.repotDriverSpeciesDefault] [taskInfo.substrate.repotReasonStale] [taskInfo.substrate.repotOverrideOwner]',
    );
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
          { repotDriver: 'EVIDENCE', repotOverrideBinding: true, repotOverrideOrigin: 'OWNER' } as any,
          t,
        ),
      ).toContain('[taskInfo.substrate.repotOverrideOwner]');
    });

    it('names the EVALUATION when the questionnaire deferred it — never the owner', () => {
      const out = repotExplanation(
        { repotDriver: 'EVIDENCE', repotOverrideBinding: true, repotOverrideOrigin: 'EVALUATION' } as any,
        t,
      );
      expect(out).toBe('[taskInfo.substrate.repotDriverEvidence] [taskInfo.substrate.repotOverrideEvaluation]');
      expect(out).not.toContain('repotOverrideOwner');
    });

    it('falls back to the author-neutral sentence when the origin is absent or null — never to the owner one', () => {
      // An older API (or a future writer that forgets to stamp an origin). Saying "the date moved" is true
      // of both authors; re-asserting "you postponed this" would reinstate the exact defect.
      for (const substrate of [
        { repotDriver: 'EVIDENCE', repotOverrideBinding: true },
        { repotDriver: 'EVIDENCE', repotOverrideBinding: true, repotOverrideOrigin: null },
      ]) {
        const out = repotExplanation(substrate as any, t);
        expect(out).toBe('[taskInfo.substrate.repotDriverEvidence] [taskInfo.substrate.repotOverrideMoved]');
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
