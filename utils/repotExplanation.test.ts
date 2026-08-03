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
      repotExplanation({ repotDriver: 'SUBSTRATE', repotOverrideBinding: true } as any, t),
    ).toBe('[taskInfo.substrate.repotDriverSubstrate] [taskInfo.substrate.repotOverrideBinding]');
  });

  it('appends the override sentence after the CROWDING driver sentence, single-space joined', () => {
    expect(
      repotExplanation({ repotDriver: 'CROWDING', repotOverrideBinding: true } as any, t),
    ).toBe('[taskInfo.substrate.repotDriverCrowding] [taskInfo.substrate.repotOverrideBinding]');
  });
});
