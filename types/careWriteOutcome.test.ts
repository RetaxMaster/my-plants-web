import { describe, expect, it } from 'vitest';
import type { CareWriteOutcome } from './api.js';

describe('CareWriteOutcome', () => {
  it('narrows on `status`, so a consumer cannot read `task` off an applied outcome', () => {
    const outcomes: CareWriteOutcome[] = [
      { status: 'applied' },
      {
        status: 'already-recorded-on-day', task: 'FERTILIZE', occurredOn: '2026-08-14',
        otherEffectsApplied: false,
      },
    ];
    const named = outcomes.map((o) => (o.status === 'already-recorded-on-day' ? o.task : null));
    expect(named).toEqual([null, 'FERTILIZE']);
  });
});
