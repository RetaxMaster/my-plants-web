import { describe, it, expect } from 'vitest';
import { resolvableEvaluationId, corroboratingSign, checkedSignIdsFrom } from './repotEvaluation';
import { REPOT_EVIDENCE_CLASSES } from '@retaxmaster/my-plants-species-schema/repot-sign-constants';
import type { PendingRepotEvaluation, RepotSign, RepotEvidenceClass } from '~/types/api';

const sign = (id: string, evidence?: RepotEvidenceClass): RepotSign =>
  ({ id, label: `label:${id}`, help: null, ...(evidence ? { evidence } : {}) });

const pending = (verdict: PendingRepotEvaluation['verdict']): PendingRepotEvaluation =>
  ({ id: `eval-${verdict}`, verdict, reevaluateOn: null });

describe('resolvableEvaluationId — only a REPOT verdict may be NAMED by a Done/Postpone', () => {
  it('returns the id of a pending REPOT verdict — the row the server will resolve', () => {
    expect(resolvableEvaluationId(pending('REPOT'))).toBe('eval-REPOT');
  });

  // THE REGRESSION. A standalone Done on `/plants/:id` can be pressed while a RE-EVALUATE row is the
  // pending one (the app said "not yet", the owner repotted anyway). Naming that row is a 400 from
  // `feedback.write-core.ts` — `Unknown or already-resolved REPOT evaluation` — because its resolution
  // lookup filters on `verdict: 'REPOT'`. The completion SUPERSEDES it instead (`completeRepotCore` step
  // 2), which needs no id at all.
  it('returns undefined for a pending RE-EVALUATE — that row is superseded by the completion, never resolved by it', () => {
    expect(resolvableEvaluationId(pending('RE-EVALUATE'))).toBeUndefined();
  });

  it('returns undefined when nothing is pending, for either spelling of nothing', () => {
    expect(resolvableEvaluationId(null)).toBeUndefined();
    expect(resolvableEvaluationId(undefined)).toBeUndefined();
  });
});

// Ids are NAMESPACED in the real catalogue (`universal--<slug>` for app-seeded pot physics,
// `<species-slug>--<slug>` for a species' own curated row), and the selection now reads that namespace, so
// the fixtures spell it the way the API does instead of using bare letters.
const uni = (slug: string, evidence?: RepotEvidenceClass): RepotSign => sign(`universal--${slug}`, evidence);
const spc = (slug: string, evidence?: RepotEvidenceClass): RepotSign =>
  sign(`nephrolepis-exaltata--${slug}`, evidence);

describe('corroboratingSign — the strongest sign that could actually CORROBORATE, species-first', () => {
  // ---- QA round 5, finding 2: `definitive` is not a corroboration -------------------------------------
  //
  // The old rule was "the strongest sign the owner did not tick", which is mathematically a CONSTANT here:
  // `definitive` is the top class, exactly one sign holds it, every species inherits it from the universal
  // set, and ticking it alone short-circuits to "repot now" — so on the "not yet" branch it is always
  // unticked and always won. QA measured 5 of 5 verdicts across 4 species returning the identical
  // suggestion. §7.17 defines `definitive` as "this alone means root-bound": it does not corroborate, it
  // DECIDES.
  it('never suggests a `definitive` sign — it decides, it does not corroborate', () => {
    const signs = [uni('pot-split-or-deformed', 'definitive'), spc('crowded-clump', 'strong')];
    expect(corroboratingSign(signs, [])?.id).toBe('nephrolepis-exaltata--crowded-clump');
  });

  it('returns null when the only unticked signs are `definitive` — no honest suggestion is left', () => {
    const signs = [uni('pot-split-or-deformed', 'definitive'), spc('crowded-clump', 'strong')];
    expect(corroboratingSign(signs, ['nephrolepis-exaltata--crowded-clump'])).toBeNull();
    expect(corroboratingSign([uni('pot-split-or-deformed', 'definitive')], [])).toBeNull();
  });

  // ---- the corroborating pool, in order ---------------------------------------------------------------
  it('prefers the strongest CORROBORATING class available, not the first row in the catalogue', () => {
    const signs = [spc('a', 'ambiguous'), spc('b', 'suggestive'), spc('c', 'definitive'), spc('d', 'strong')];
    expect(corroboratingSign(signs, [])?.id).toBe('nephrolepis-exaltata--d');
  });

  it('skips every sign the owner already checked — never suggests looking for what they just reported', () => {
    const signs = [spc('a', 'strong'), spc('b', 'suggestive'), spc('c', 'ambiguous')];
    expect(corroboratingSign(signs, ['nephrolepis-exaltata--a'])?.id).toBe('nephrolepis-exaltata--b');
    expect(corroboratingSign(signs, ['nephrolepis-exaltata--a', 'nephrolepis-exaltata--b'])?.id)
      .toBe('nephrolepis-exaltata--c');
  });

  // ---- QA round 5, finding 2, part two: the feature is sold as species-aware --------------------------
  it('prefers THIS species\' own sign over a universal one at equal rank', () => {
    // Universal first in catalogue order, so only the species preference can move the answer.
    const signs = [uni('water-runs-through', 'strong'), spc('crowded-clump', 'strong')];
    expect(corroboratingSign(signs, [])?.id).toBe('nephrolepis-exaltata--crowded-clump');
  });

  it('does NOT let the species preference outrank the evidence class — rank is decided first', () => {
    const signs = [uni('water-runs-through', 'strong'), spc('slowed-growth', 'ambiguous')];
    expect(corroboratingSign(signs, [])?.id).toBe('universal--water-runs-through');
  });

  it('falls back to a universal sign when the species has none left at that rank', () => {
    const signs = [uni('water-runs-through', 'strong'), spc('crowded-clump', 'strong')];
    expect(corroboratingSign(signs, ['nephrolepis-exaltata--crowded-clump'])?.id)
      .toBe('universal--water-runs-through');
  });

  // ---- the guarantees that must survive the change ----------------------------------------------------
  it('returns null when every sign is checked, or when the catalogue is empty/absent — the caller then ' +
    'shows the ordinary copy alone, which is a complete answer', () => {
    const signs = [spc('a', 'strong'), spc('b', 'ambiguous')];
    expect(corroboratingSign(signs, ['nephrolepis-exaltata--a', 'nephrolepis-exaltata--b'])).toBeNull();
    expect(corroboratingSign([], [])).toBeNull();
    expect(corroboratingSign(null, null)).toBeNull();
    expect(corroboratingSign(undefined, undefined)).toBeNull();
  });

  it('handles the single-sign catalogue both ways — the only sign when unchecked, nothing when checked', () => {
    expect(corroboratingSign([spc('only', 'strong')], [])?.id).toBe('nephrolepis-exaltata--only');
    expect(corroboratingSign([spc('only', 'strong')], ['nephrolepis-exaltata--only'])).toBeNull();
  });

  it('still suggests when only AMBIGUOUS signs remain — and it is honest arithmetic, not a consolation ' +
    'prize: `strong` (0.60) + `ambiguous` (0.15) lands exactly on SIGN_NEEDED_THRESHOLD (0.75), so an ' +
    'ambiguous sign genuinely can be the one that moves the answer (docs/care-engine.md §7.17)', () => {
    const signs = [spc('strong-one', 'strong'), spc('vague', 'ambiguous')];
    expect(corroboratingSign(signs, ['nephrolepis-exaltata--strong-one'])?.id).toBe('nephrolepis-exaltata--vague');
  });

  // DETERMINISM is a requirement: two identical submissions that suggested different signs would read as a
  // bug. A FULL tie (same rank, same namespace) resolves to catalogue order — the array as the API
  // returned it, sorted by sortOrder then id.
  it('is DETERMINISTIC on a full tie — the first row of the strongest class wins, every time', () => {
    const signs = [spc('first', 'strong'), spc('second', 'strong'), spc('third', 'strong')];
    for (let i = 0; i < 10; i += 1) expect(corroboratingSign(signs, [])?.id).toBe('nephrolepis-exaltata--first');
    const universals = [uni('first', 'strong'), uni('second', 'strong')];
    for (let i = 0; i < 10; i += 1) expect(corroboratingSign(universals, [])?.id).toBe('universal--first');
  });

  // An older API (rolling deploy) publishes no `evidence` at all, and a catalogue row could in principle
  // hold something outside the enum. Neither may outrank a class we actually know — and, just as
  // importantly, neither is mistaken for `definitive` and dropped.
  it('ranks an absent or unrecognised class LAST — never suggested ahead of a real one, never excluded', () => {
    expect(corroboratingSign([spc('unknown'), spc('vague', 'ambiguous')], [])?.id)
      .toBe('nephrolepis-exaltata--vague');
    expect(
      corroboratingSign(
        [spc('bogus', 'important' as RepotEvidenceClass), spc('vague', 'ambiguous')],
        [],
      )?.id,
    ).toBe('nephrolepis-exaltata--vague');
    // …but it is still a usable answer when it is ALL there is, rather than a silent nothing.
    expect(corroboratingSign([spc('unknown')], [])?.id).toBe('nephrolepis-exaltata--unknown');
  });

  // The ranking is DERIVED from the shared contract's own ordinal array, so a fifth class added upstream
  // ranks correctly with no edit here. This pins that derivation rather than the literals — minus the one
  // class that is deliberately never offered.
  it('ranks exactly as the shared REPOT_EVIDENCE_CLASSES array orders them, minus `definitive`', () => {
    const corroborating = REPOT_EVIDENCE_CLASSES.filter((c) => c !== 'definitive');
    const signs = REPOT_EVIDENCE_CLASSES.map((c) => spc(c, c));
    const seen: string[] = [];
    for (let i = 0; i < REPOT_EVIDENCE_CLASSES.length; i += 1) {
      const next = corroboratingSign(signs, seen);
      if (!next) break;
      seen.push(next.id);
    }
    expect(seen).toEqual(corroborating.map((c) => `nephrolepis-exaltata--${c}`));
  });
});

// The one-line rule both renderers used to carry inline (PlantDetail.vue and pages/index.vue), extracted
// beside the other two rules about what an evaluation answer means. Only the `signs` answer reports
// observations; the other two mean "nothing to subtract", whatever they happen to carry.
describe('checkedSignIdsFrom — only a checked-signs answer reports sign ids', () => {
  it('returns the submitted ids for a signs answer', () => {
    expect(checkedSignIdsFrom({ answer: 'signs', signIds: ['s1', 's2'] })).toEqual(['s1', 's2']);
  });

  it('returns a COPY — the source is the attempt\'s frozen envelope and must stay byte-identical (U2)', () => {
    const signIds = ['s1'];
    const out = checkedSignIdsFrom({ answer: 'signs', signIds });
    out.push('mutated');
    expect(signIds).toEqual(['s1']);
  });

  it('returns nothing for the other answers, even if ids somehow ride along', () => {
    expect(checkedSignIdsFrom({ answer: 'no-signs' })).toEqual([]);
    expect(checkedSignIdsFrom({ answer: 'cannot-check' })).toEqual([]);
    expect(checkedSignIdsFrom({ answer: 'no-signs', signIds: ['s1'] })).toEqual([]);
  });

  it('tolerates a missing body and a signs answer with no ids array', () => {
    expect(checkedSignIdsFrom(null)).toEqual([]);
    expect(checkedSignIdsFrom(undefined)).toEqual([]);
    expect(checkedSignIdsFrom({ answer: 'signs' })).toEqual([]);
  });
});
