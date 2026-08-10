import { describe, expect, it } from 'vitest';
import { RECOMMENDATIONS, HOLD_BASES, UNAVAILABLE_REASONS } from '@retaxmaster/my-plants-species-schema/watering-verdict-constants';
import type { Recommendation, HoldBasis, UnavailableReason } from './api';

// Mechanical parity (mirrors photo-contract.parity.test.ts): the web's TS unions ARE the shared arrays. A
// type-level assertion catches drift at compile time; the runtime asserts the arrays themselves so a future
// value added on one side fails this test until both are updated.
describe('watering-verdict contract parity', () => {
  it('the web unions equal the shared value sets exactly', () => {
    const recommendations: Recommendation[] = [...RECOMMENDATIONS];
    const bases: HoldBasis[] = [...HOLD_BASES];
    const reasons: UnavailableReason[] = [...UNAVAILABLE_REASONS];
    expect(recommendations).toEqual(['WATER_NOW', 'HOLD', 'UNAVAILABLE']);
    expect(bases).toEqual(['MEASURED_SLOPE', 'SHORT_RECHECK']);
    expect(reasons).toEqual(['NEEDS_CALIBRATION', 'NOT_MEASURABLE']);
  });
});
