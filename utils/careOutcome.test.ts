import { describe, expect, it } from 'vitest';
import { careOutcomeNoteKey, doneSubmitPath } from './careOutcome.js';
import type { CareWriteOutcome } from '../types/api.js';

const applied: CareWriteOutcome = { status: 'applied' };
const already = (task: 'WATER' | 'FERTILIZE' | 'REPOT' | 'ROTATE' | 'CLEAN_LEAVES'): CareWriteOutcome =>
  // otherEffectsApplied is irrelevant to which SENTENCE an outcome earns (this file's whole subject), so
  // every fixture here fixes it to `false` — REPOT's `true` case is Task 10's, not this pure function's.
  ({ status: 'already-recorded-on-day', task, occurredOn: '2026-08-12', otherEffectsApplied: false });

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

  it('gives every other one-per-day task the neutral sentence, on both paths', () => {
    for (const task of ['WATER', 'REPOT', 'ROTATE', 'CLEAN_LEAVES'] as const) {
      expect(careOutcomeNoteKey(already(task), 'same-day')).toBe('tasks.alreadyRecorded.neutral');
      expect(careOutcomeNoteKey(already(task), 'back-dated')).toBe('tasks.alreadyRecorded.neutral');
    }
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
