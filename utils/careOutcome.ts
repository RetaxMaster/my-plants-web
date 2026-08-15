import type { CareWriteOutcome, SubstrateAnchorOutcome } from '../types/api.js';

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

/**
 * ---- THE SUBSTRATE CLOCK'S OWN SENTENCE (owner ruling, 2026-08-14; API finding E8) -------------------
 *
 * The substrate anchor — the day the app tracks as "when this pot was last filled" — only ever moves
 * FORWARD. A repot completion dated strictly BEFORE the stored anchor is still recorded as a real event
 * (the owner logged something that happened), but the clock stays where the newer repot put it and no
 * calibrated reading is retracted. That refusal is invisible in the write's other outcome, so it earns its
 * own sentence.
 *
 * ⚠️ A SECOND, INDEPENDENT NOTE — NOT a replacement for `careOutcomeNoteKey`'s. Both can be true at once,
 * and the case where they are is the sharpest one this fix exists for: a same-day DUPLICATE completion
 * naming an older day is `already-recorded-on-day` AND anchor-kept (the API measured that combination
 * dragging the clock 197 days backwards). Rendering only one of the two tells the owner half of what
 * happened, so both callers render both, in the one notice zone they already have.
 *
 * `null` means "say nothing": a `refreshed` anchor is an ordinary success, and an ABSENT `substrate` is an
 * API that did not state the fact (a rolling deploy) — never invent a sentence about either.
 *
 * Returns the surviving anchor as a RAW `YYYY-MM-DD`, deliberately unformatted: the caller formats it at
 * RENDER time with the live locale (`$d(ymdToLocalDate(day), 'short')`, the same way every other date on
 * these surfaces is rendered), so a locale switch after the submit re-renders the date instead of freezing
 * it in the language that was active when the request returned.
 *
 * `SUBSTRATE_ANCHOR_KEPT_KEY` STAYS EXPORTED even though `careOutcomeNoteText` below is now its only
 * caller (F13 collapsed the three surfaces' private copies onto that one combiner). It is the app's single
 * NAME for this sentence, and a grep for the key has to land on a declaration rather than on a string
 * buried inside a function body — the same reason `AgentChat.vue` spells its `OUTCOME_SUMMARY_KEYS` out
 * instead of building them from a template literal. It is not dead: un-exporting it would only hide it.
 */
export const SUBSTRATE_ANCHOR_KEPT_KEY = 'tasks.substrateAnchorKept';

export function substrateAnchorKeptDay(
  substrate: SubstrateAnchorOutcome | undefined,
): string | null {
  if (!substrate || substrate.status !== 'kept') return null;
  return substrate.refreshedOn;
}

/**
 * THE ONE PLACE THE TWO SENTENCES ARE COMBINED — for all THREE surfaces that can produce them.
 *
 * Both notes are independent facts and both can be true at once (see `substrateAnchorKeptDay` above for
 * the case that pairing exists for), so every surface has to render "the one, the other, both, or
 * nothing". That is a rule, not a formatting detail: the order the owner reads them in, the separator,
 * and — most of all — WHICH DATE goes into the anchor sentence.
 *
 * It lives here because there are now THREE callers, not two: Today (`pages/index.vue`), the plant page
 * (`components/PlantDetail.vue`), and the agent proposal-approval surface (`components/AgentChat.vue`),
 * which reached the same outcome by a different route — the owner approving a repot an AGENT proposed. The
 * first two had a copy each; a third copy is exactly the parallel-per-surface drift this project names as
 * its highest-yield bug class, and it is also how the agent path came to answer this question with SILENCE
 * while the owner's own path answered it with a sentence.
 *
 * ⚠️ THE DATE IS ALWAYS THE SURVIVING ANCHOR, never the day the completion asked for. `refreshedOn` on a
 * `kept` outcome IS the surviving one (the shared contract says so at the declaration) — which is why this
 * function takes the already-extracted day from `substrateAnchorKeptDay` rather than the raw outcome: there
 * is one place that picks the date, and it cannot pick the other one.
 *
 * `t` and `formatDay` are INJECTED rather than imported: this is a plain util with no Vue/i18n context of
 * its own, and each caller already holds its own `useI18n()` binding. `formatDay` is `$d(ymdToLocalDate(d),
 * 'short')` at every call site — resolved at RENDER time, so a locale switch after the submit re-formats
 * the date instead of freezing it in the language that was active when the request returned.
 *
 * `null` means "render no notice at all" — which is what an absent `substrate` and an ordinary `applied`
 * outcome both legitimately produce.
 */
export function careOutcomeNoteText(
  noteKey: string | null,
  anchorDay: string | null,
  t: (key: string, named?: Record<string, unknown>) => string,
  formatDay: (day: string) => string,
): string | null {
  const parts = [
    noteKey ? t(noteKey) : null,
    anchorDay ? t(SUBSTRATE_ANCHOR_KEPT_KEY, { date: formatDay(anchorDay) }) : null,
  ].filter((part): part is string => !!part);
  return parts.length ? parts.join(' ') : null;
}
