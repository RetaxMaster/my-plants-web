import type { CareWriteOutcome } from '../types/api.js';

/**
 * WHICH SENTENCE A ONE-PER-DAY OUTCOME EARNS (spec §3.2, consumer 1) — decided ONCE, for both renderers.
 *
 * Today can only ever produce the same-day path (its rows carry no date box); the plant page produces
 * both. The rule lives here rather than in either page because a rule enforced per-renderer is found one
 * renderer at a time — this feature's own most expensive lesson.
 */
export type DoneSubmitPath = 'same-day' | 'back-dated';

/**
 * An EMPTY date box means today — that is what `TaskRow`'s own `onDone` emits (`doneDate.value ||
 * undefined`) and what both pages already substitute (`occurredOn || today()`). So absent, blank, and
 * today's own date are the same path; anything else is the owner recording history.
 *
 * Compared as `YYYY-MM-DD` strings, never as `Date`s: a bare ymd parses as UTC midnight and names the
 * previous day west of Greenwich, which would put a Mexican owner's same-day press on the back-dated path
 * every evening after 18:00.
 */
export function doneSubmitPath(occurredOn: string | undefined, today: string): DoneSubmitPath {
  if (!occurredOn) return 'same-day';
  return occurredOn === today ? 'same-day' : 'back-dated';
}

/**
 * `null` means "say nothing" — an APPLIED outcome is an ordinary success and needs no sentence, and an
 * absent outcome (an older API during a rolling deploy) must never render a message about a fact the
 * server did not state.
 *
 * ⚠️ FERTILIZE'S TWO KEYS ARE NOT INTERCHANGEABLE (principal intent-pass ruling, 2026-08-14). The
 * imperative warning belongs to the owner who might be about to fertilize again — the same-day press. The
 * back-dated case is somebody recording history, and warning him not to do something he is not doing reads
 * as the app misunderstanding what just happened. Two keys, never one key with a conditional half.
 *
 * ⚠️ `otherEffectsApplied: true` EARNS ITS OWN SENTENCE, KEYED ON THE CONTRACT MEMBER, NEVER ON THE TASK
 * (F2 fix, 2026-08-14). The API states outright (`repot-complete.write-core.ts`) that on a duplicate REPOT
 * "the care-event write" is the ONLY thing suppressed — the profile update, the substrate refresh
 * (`substrate_refreshed_on` re-anchored) and the care-plan recompute all still run. The neutral fallthrough
 * below says "nothing was added", which is exactly the phrasing the shared contract's own doc-comment
 * (`care-outcome.ts`) forbids for that case. Branching on `outcome.otherEffectsApplied` — rather than on
 * `outcome.task === 'REPOT'` — is deliberate: REPOT is the only task that carries side effects TODAY, but a
 * future task could too, and the contract member is exactly what exists so a surface never has to hardcode
 * which task that is. This branch sits AFTER the FERTILIZE check (FERTILIZE can never carry side effects —
 * an over-fertilize risk has no "other effects" to speak of) and BEFORE the neutral fallthrough, so it only
 * ever fires for WATER, REPOT, ROTATE and CLEAN_LEAVES.
 */
export function careOutcomeNoteKey(
  outcome: CareWriteOutcome | undefined,
  path: DoneSubmitPath,
): string | null {
  if (!outcome || outcome.status !== 'already-recorded-on-day') return null;
  if (outcome.task === 'FERTILIZE') {
    return path === 'same-day'
      ? 'tasks.alreadyRecorded.fertilizeSameDay'
      : 'tasks.alreadyRecorded.fertilizeBackDated';
  }
  if (outcome.otherEffectsApplied) {
    return 'tasks.alreadyRecorded.otherEffectsApplied';
  }
  // WATER, REPOT, ROTATE and CLEAN_LEAVES with no other effects: a neutral statement of fact. MIST has no
  // dedup at all and can never reach this branch — misting twice on a hot day is a genuine second event
  // (owner decision 7).
  return 'tasks.alreadyRecorded.neutral';
}
