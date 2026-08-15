import { describe, expect, it } from 'vitest';
import { careOutcomeNoteKey, doneSubmitPath, substrateAnchorKeptDay } from './careOutcome.js';
import type { CareWriteOutcome, SubstrateAnchorOutcome } from '../types/api.js';

const applied: CareWriteOutcome = { status: 'applied' };
const already = (
  task: 'WATER' | 'FERTILIZE' | 'REPOT' | 'ROTATE' | 'CLEAN_LEAVES',
  otherEffectsApplied = false,
): CareWriteOutcome =>
  ({ status: 'already-recorded-on-day', task, occurredOn: '2026-08-12', otherEffectsApplied });

describe('careOutcomeNoteKey', () => {
  it('says NOTHING on an applied outcome — a successful record needs no sentence', () => {
    expect(careOutcomeNoteKey(applied, 'same-day')).toBeNull();
    expect(careOutcomeNoteKey(applied, 'back-dated')).toBeNull();
  });

  it('says nothing when the server sent no outcome at all (an older API mid rolling deploy)', () => {
    expect(careOutcomeNoteKey(undefined, 'same-day')).toBeNull();
  });

  it('gives FERTILIZE the IMPERATIVE warning on the same-day path only', () => {
    expect(careOutcomeNoteKey(already('FERTILIZE'), 'same-day'))
      .toBe('tasks.alreadyRecorded.fertilizeSameDay');
  });

  it('gives FERTILIZE the FACTUAL sentence when the owner is recording history', () => {
    // The split is an intent-pass ruling: "do not fertilize again" warns against an action nobody is
    // taking when the owner is back-dating, and reads as the app misunderstanding what just happened.
    expect(careOutcomeNoteKey(already('FERTILIZE'), 'back-dated'))
      .toBe('tasks.alreadyRecorded.fertilizeBackDated');
  });

  it('never hands one FERTILIZE path the OTHER path\'s key', () => {
    const sameDay = careOutcomeNoteKey(already('FERTILIZE'), 'same-day');
    const backDated = careOutcomeNoteKey(already('FERTILIZE'), 'back-dated');
    expect(sameDay).not.toBe(backDated);
  });

  it('gives every other one-per-day task the neutral sentence, on both paths, when otherEffectsApplied is false', () => {
    for (const task of ['WATER', 'REPOT', 'ROTATE', 'CLEAN_LEAVES'] as const) {
      expect(careOutcomeNoteKey(already(task), 'same-day')).toBe('tasks.alreadyRecorded.neutral');
      expect(careOutcomeNoteKey(already(task), 'back-dated')).toBe('tasks.alreadyRecorded.neutral');
    }
  });

  // F2 fix: a duplicate REPOT (or any one-per-day task) still runs its OTHER side effects — the neutral
  // "nothing was added" sentence is exactly the phrasing the shared contract forbids for this case.
  it('gives the effects-applied sentence when otherEffectsApplied is true, on both paths — keyed on the CONTRACT MEMBER, never on the task', () => {
    for (const task of ['WATER', 'REPOT', 'ROTATE', 'CLEAN_LEAVES'] as const) {
      expect(careOutcomeNoteKey(already(task, true), 'same-day')).toBe('tasks.alreadyRecorded.otherEffectsApplied');
      expect(careOutcomeNoteKey(already(task, true), 'back-dated')).toBe('tasks.alreadyRecorded.otherEffectsApplied');
    }
  });

  it('never picks the neutral key for an outcome that carries otherEffectsApplied: true', () => {
    const outcome = already('REPOT', true);
    expect(careOutcomeNoteKey(outcome, 'same-day')).not.toBe('tasks.alreadyRecorded.neutral');
  });

  it('never gives FERTILIZE the effects-applied sentence — FERTILIZE can never carry side effects', () => {
    expect(careOutcomeNoteKey(already('FERTILIZE', true), 'same-day'))
      .toBe('tasks.alreadyRecorded.fertilizeSameDay');
    expect(careOutcomeNoteKey(already('FERTILIZE', true), 'back-dated'))
      .toBe('tasks.alreadyRecorded.fertilizeBackDated');
  });
});

describe('doneSubmitPath', () => {
  it('reads an empty box as the same day — an empty date box MEANS today', () => {
    expect(doneSubmitPath(undefined, '2026-08-14')).toBe('same-day');
    expect(doneSubmitPath('', '2026-08-14')).toBe('same-day');
  });

  it('reads today\'s own date as the same day too', () => {
    expect(doneSubmitPath('2026-08-14', '2026-08-14')).toBe('same-day');
  });

  it('reads any other day as back-dated', () => {
    expect(doneSubmitPath('2026-08-12', '2026-08-14')).toBe('back-dated');
  });
});

// ---- THE SUBSTRATE CLOCK'S OWN OUTCOME (owner ruling, 2026-08-14; API finding E8) --------------------
//
// A SECOND, independent fact from the one-per-day outcome above — the two are never derived from each
// other, and the case this fix exists for is the one where both are true at once.
describe('substrateAnchorKeptDay', () => {
  const kept: SubstrateAnchorOutcome = { status: 'kept', refreshedOn: '2026-08-11' };
  const refreshed: SubstrateAnchorOutcome = { status: 'refreshed', refreshedOn: '2026-08-14' };

  it('returns the SURVIVING anchor when the clock refused to move', () => {
    expect(substrateAnchorKeptDay(kept)).toBe('2026-08-11');
  });

  it('says nothing when the clock really moved — an ordinary success needs no sentence', () => {
    expect(substrateAnchorKeptDay(refreshed)).toBeNull();
  });

  it('says nothing when the server stated no substrate outcome at all (an older API mid rolling deploy)', () => {
    expect(substrateAnchorKeptDay(undefined)).toBeNull();
    // POSITIVE CONTROL for the two nulls above: the same function does return a day when there is one, so
    // these are decisions rather than a function that can only ever answer null.
    expect(substrateAnchorKeptDay(kept)).not.toBeNull();
  });

  it('returns a RAW YYYY-MM-DD — formatting is the renderer\'s job, at render time, in the live locale', () => {
    expect(substrateAnchorKeptDay(kept)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
