import { describe, it, expect } from 'vitest';
import { resolvableEvaluationId, corroboratingSign } from './repotEvaluation';
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

describe('corroboratingSign — the strongest sign the owner did NOT tick', () => {
  it('prefers the strongest class available, not the first row in the catalogue', () => {
    const signs = [sign('a', 'ambiguous'), sign('b', 'suggestive'), sign('c', 'definitive'), sign('d', 'strong')];
    expect(corroboratingSign(signs, [])?.id).toBe('c');
  });

  it('skips every sign the owner already checked — never suggests looking for what they just reported', () => {
    const signs = [sign('a', 'definitive'), sign('b', 'strong'), sign('c', 'suggestive')];
    expect(corroboratingSign(signs, ['a'])?.id).toBe('b');
    expect(corroboratingSign(signs, ['a', 'b'])?.id).toBe('c');
  });

  it('returns null when every sign is checked, or when the catalogue is empty/absent — the caller then ' +
    'shows the ordinary copy alone, which is a complete answer', () => {
    const signs = [sign('a', 'strong'), sign('b', 'ambiguous')];
    expect(corroboratingSign(signs, ['a', 'b'])).toBeNull();
    expect(corroboratingSign([], [])).toBeNull();
    expect(corroboratingSign(null, null)).toBeNull();
    expect(corroboratingSign(undefined, undefined)).toBeNull();
  });

  it('handles the single-sign catalogue both ways — the only sign when unchecked, nothing when checked', () => {
    expect(corroboratingSign([sign('only', 'strong')], [])?.id).toBe('only');
    expect(corroboratingSign([sign('only', 'strong')], ['only'])).toBeNull();
  });

  it('still suggests when only AMBIGUOUS signs remain — and it is honest arithmetic, not a consolation ' +
    'prize: `strong` (0.60) + `ambiguous` (0.15) lands exactly on SIGN_NEEDED_THRESHOLD (0.75), so an ' +
    'ambiguous sign genuinely can be the one that moves the answer (docs/care-engine.md §7.17)', () => {
    const signs = [sign('strong-one', 'strong'), sign('vague', 'ambiguous')];
    expect(corroboratingSign(signs, ['strong-one'])?.id).toBe('vague');
  });

  // DETERMINISM is a requirement: two identical submissions that suggested different signs would read as a
  // bug. Ties resolve to catalogue order (the array as the API returned it, sorted by sortOrder then id).
  it('is DETERMINISTIC on a tie — the first row of the strongest class wins, every time', () => {
    const signs = [sign('first', 'strong'), sign('second', 'strong'), sign('third', 'strong')];
    for (let i = 0; i < 10; i += 1) expect(corroboratingSign(signs, [])?.id).toBe('first');
  });

  // An older API (rolling deploy) publishes no `evidence` at all, and a catalogue row could in principle
  // hold something outside the enum. Neither may outrank a class we actually know.
  it('ranks an absent or unrecognised class LAST — never suggested ahead of a real one', () => {
    expect(corroboratingSign([sign('unknown'), sign('vague', 'ambiguous')], [])?.id).toBe('vague');
    expect(corroboratingSign([sign('bogus', 'important' as RepotEvidenceClass), sign('vague', 'ambiguous')], [])?.id)
      .toBe('vague');
    // …but it is still a usable answer when it is ALL there is, rather than a silent nothing.
    expect(corroboratingSign([sign('unknown')], [])?.id).toBe('unknown');
  });

  // The ranking is DERIVED from the shared contract's own ordinal array, so a fifth class added upstream
  // ranks correctly with no edit here. This pins that derivation rather than the four literals.
  it('ranks exactly as the shared REPOT_EVIDENCE_CLASSES array orders them, strongest first', () => {
    const signs = REPOT_EVIDENCE_CLASSES.map((c) => sign(c, c));
    const seen: string[] = [];
    for (let i = 0; i < REPOT_EVIDENCE_CLASSES.length; i += 1) {
      const next = corroboratingSign(signs, seen);
      seen.push(next!.id);
    }
    expect(seen).toEqual([...REPOT_EVIDENCE_CLASSES]);
  });
});
