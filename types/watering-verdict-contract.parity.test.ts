import { describe, expect, it } from 'vitest';
import { RECOMMENDATIONS, HOLD_BASES, UNAVAILABLE_REASONS } from '@retaxmaster/my-plants-species-schema/watering-verdict-constants';
import type { Recommendation, HoldBasis, UnavailableReason } from './api';

// Mechanical parity (mirrors photo-contract.parity.test.ts, WITH one deliberate improvement over it — see
// the note below). What this test actually verifies: that `types/api.ts`'s `Recommendation`/`HoldBasis`/
// `UnavailableReason` are EXACTLY the shared package's `RECOMMENDATIONS`/`HOLD_BASES`/`UNAVAILABLE_REASONS`
// arrays, neither narrower nor wider, and that the array ORDER matches (the type check alone cannot see
// ordering). It does NOT catch cross-repo version skew — this test only ever sees whatever version of the
// contract package is installed in node_modules right now; that guarantee belongs to the
// pack-and-install workflow step (`./scripts/pack-species-schema-and-install.sh` + the installed-version
// check), not to this test.
//
// `type Equal<A, B>` is a BIDIRECTIONAL equality check, not a one-directional assignability check. A plain
// `const x: Recommendation[] = [...RECOMMENDATIONS]` (the shape photo-contract.parity.test.ts still uses)
// only catches a NARROWER or renamed hand-retype — TypeScript array assignment is covariant, so a WIDER
// hand-retype (e.g. `types/api.ts` re-forked back to a literal union with an extra value never in the
// shared array) compiles cleanly and the drift ships silently. `Equal` fails to compile on EITHER
// direction, which is the actual regression this test exists to guard: someone re-forking the union by
// hand instead of deriving it. `photo-contract.parity.test.ts` still uses the weaker one-directional
// shape — deliberately left alone here (it belongs to a different feature) — and would benefit from the
// identical `Equal` treatment the next time someone touches it.
// Wrapped in single-element tuples ([A] extends [B], not A extends B) to defeat TypeScript's DISTRIBUTIVE
// conditional-type behaviour: a bare `A extends B` distributes over a union A, evaluating member-by-member
// and unioning the per-member true/false results back together into the type `boolean` the moment the
// union disagrees with itself on even one member -- and `boolean` is assignable from the literal `true`,
// so a plain (non-tuple-wrapped) version of this check silently PASSES on exactly the widening mutation it
// exists to catch. Tuple-wrapping makes each side a single non-distributed type, so the comparison is
// atomic.
type Equal<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const _recommendationEqual: Equal<Recommendation, (typeof RECOMMENDATIONS)[number]> = true;
const _holdBasisEqual: Equal<HoldBasis, (typeof HOLD_BASES)[number]> = true;
const _unavailableReasonEqual: Equal<UnavailableReason, (typeof UNAVAILABLE_REASONS)[number]> = true;
void _recommendationEqual;
void _holdBasisEqual;
void _unavailableReasonEqual;

describe('watering-verdict contract parity', () => {
  it('the web unions equal the shared value sets exactly, including order', () => {
    // The type-level `Equal` assertions above prove SET equality at compile time; this proves the
    // shared arrays' declared ORDER, which the type check cannot see (a union type has no order).
    const recommendations: Recommendation[] = [...RECOMMENDATIONS];
    const bases: HoldBasis[] = [...HOLD_BASES];
    const reasons: UnavailableReason[] = [...UNAVAILABLE_REASONS];
    expect(recommendations).toEqual(['WATER_NOW', 'HOLD', 'UNAVAILABLE']);
    expect(bases).toEqual(['MEASURED_SLOPE', 'SHORT_RECHECK']);
    expect(reasons).toEqual(['NEEDS_CALIBRATION', 'NOT_MEASURABLE']);
  });
});
