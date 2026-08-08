import { describe, expect, it } from 'vitest';
import { fertilizeExplanation } from './fertilizeExplanation.js';

const t = (k: string) => k; // identity translator — the composition is what is under test, not the copy

describe('fertilizeExplanation — ONE SENTENCE PER CAUSE (spec §2.1, ledger D3)', () => {
  it('returns undefined when nothing moved the override', () => {
    expect(fertilizeExplanation({ overrideOn: '2026-10-01', overrideMovedBy: [] }, t)).toBeUndefined();
  });

  it('returns undefined when there is no override at all', () => {
    expect(fertilizeExplanation({ overrideOn: null, overrideMovedBy: [] }, t)).toBeUndefined();
  });

  it('renders the FLOOR sentence alone', () => {
    expect(fertilizeExplanation({ overrideOn: '2026-08-08', overrideMovedBy: ['FLOOR'] }, t))
      .toBe('taskInfo.substrate.fertilizeOverrideFloor');
  });

  it('renders the SNAP sentence alone', () => {
    expect(fertilizeExplanation({ overrideOn: '2026-10-01', overrideMovedBy: ['SNAP'] }, t))
      .toBe('taskInfo.substrate.fertilizeOverrideSnap');
  });

  it('renders BOTH sentences when both causes acted — never one sentence standing in for two facts', () => {
    // The defect this asserts against is one this codebase has already shipped once and fixed: a single
    // override sentence served two different authors and told the owner they had postponed something
    // they never touched (see utils/repotExplanation.ts's own comment). Repeating it inside the change
    // whose purpose is removing dishonest claims would be a new dishonest claim.
    expect(fertilizeExplanation({ overrideOn: '2026-08-08', overrideMovedBy: ['FLOOR', 'SNAP'] }, t))
      .toBe('taskInfo.substrate.fertilizeOverrideFloor taskInfo.substrate.fertilizeOverrideSnap');
  });

  it('renders FLOOR before SNAP regardless of the order the payload lists them in — cause, then consequence', () => {
    expect(fertilizeExplanation({ overrideOn: '2026-08-08', overrideMovedBy: ['SNAP', 'FLOOR'] }, t))
      .toBe('taskInfo.substrate.fertilizeOverrideFloor taskInfo.substrate.fertilizeOverrideSnap');
  });

  it('tolerates a missing block from an older API', () => {
    expect(fertilizeExplanation(undefined, t)).toBeUndefined();
    expect(fertilizeExplanation(null, t)).toBeUndefined();
  });
});
