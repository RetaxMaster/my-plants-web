import { describe, expect, it } from 'vitest';
import {
  POT_DETAILS_DISCARDED_KEY,
  SUBSTRATE_ANCHOR_KEPT_KEY,
  careOutcomeNoteKey,
  careOutcomeNoteText,
  doneSubmitPath,
  potDetailsDiscardedNoteKey,
  substrateAnchorKeptDay,
} from './careOutcome.js';
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

// ---- F4 (nothing-left-open code review, 2026-08-14) --------------------------------------------------
//
// A refused REPOT day that is ALSO a same-day duplicate writes no CareEvent, so the diameter and mix the
// owner typed have nowhere to live and nothing on any surface said so. The server states the fact; these
// readers only carry it.
describe('potDetailsDiscardedNoteKey', () => {
  const discarded: CareWriteOutcome = {
    status: 'already-recorded-on-day',
    task: 'REPOT',
    occurredOn: '2026-08-12',
    otherEffectsApplied: false,
    potDetailsDiscarded: true,
  };

  it('earns the sentence when the server said the details were discarded', () => {
    expect(potDetailsDiscardedNoteKey(discarded)).toBe(POT_DETAILS_DISCARDED_KEY);
  });

  it('says NOTHING when the flag is absent — even on the outcome shape that could be re-derived', () => {
    // ⚠️ THIS IS THE POINT OF THE FLAG. The trio (already-recorded + otherEffectsApplied:false + REPOT) is
    // exactly the branch that CAN discard, and this outcome is that branch with nothing supplied ("I don't
    // know" for both fields). A surface re-deriving the sentence from the trio would state it here, about
    // values the owner never typed.
    expect(potDetailsDiscardedNoteKey(already('REPOT', false))).toBeNull();
  });

  it('says nothing for an ORDINARY applied outcome (no flag set), or for an absent one (an older API mid rolling deploy)', () => {
    expect(potDetailsDiscardedNoteKey(applied)).toBeNull();
    expect(potDetailsDiscardedNoteKey(undefined)).toBeNull();
  });

  // ⚠️ F5 AMENDMENT (owner ruling, 2026-08-15) — the status gate this function used to carry
  // (`outcome.status !== 'already-recorded-on-day'`) is GONE. A refused REPOT day that is NOT a same-day
  // duplicate still writes a `CareEvent` (`status: 'applied'`), but the values it carries sit in a payload
  // the app renders nowhere — the visible profile is untouched either way, so the sentence now fires on
  // this arm too whenever the server's own flag says so.
  it('DOES earn the sentence on an APPLIED outcome now, when the server\'s flag is set (F5 amendment)', () => {
    const appliedAndDiscarded: CareWriteOutcome = { status: 'applied', potDetailsDiscarded: true };
    expect(potDetailsDiscardedNoteKey(appliedAndDiscarded)).toBe(POT_DETAILS_DISCARDED_KEY);
  });
});

describe('careOutcomeNoteText — the one combiner, now over THREE independent facts', () => {
  const t = (key: string, named?: Record<string, unknown>) =>
    named ? `${key}(${JSON.stringify(named)})` : key;
  const formatDay = (day: string) => `formatted:${day}`;

  it('renders all three, in reading order, when all three are true — E8\'s own 197-day case', () => {
    const text = careOutcomeNoteText(
      'tasks.alreadyRecorded.neutral',
      '2026-08-11',
      POT_DETAILS_DISCARDED_KEY,
      t,
      formatDay,
    );
    expect(text).toBe(
      `tasks.alreadyRecorded.neutral ${SUBSTRATE_ANCHOR_KEPT_KEY}({"date":"formatted:2026-08-11"}) ` +
        POT_DETAILS_DISCARDED_KEY,
    );
  });

  it('renders the pot-details sentence ALONE — it is a complete explanation, never a footnote', () => {
    expect(careOutcomeNoteText(null, null, POT_DETAILS_DISCARDED_KEY, t, formatDay))
      .toBe(POT_DETAILS_DISCARDED_KEY);
  });

  it('still renders nothing at all when no fact is true', () => {
    expect(careOutcomeNoteText(null, null, null, t, formatDay)).toBeNull();
  });

  it('leaves the two pre-existing sentences byte-identical when the third is absent', () => {
    expect(careOutcomeNoteText('tasks.alreadyRecorded.neutral', '2026-08-11', null, t, formatDay)).toBe(
      `tasks.alreadyRecorded.neutral ${SUBSTRATE_ANCHOR_KEPT_KEY}({"date":"formatted:2026-08-11"})`,
    );
  });
});
