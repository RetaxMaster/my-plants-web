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
 * "the care-event write" is the ONLY thing unconditionally suppressed — the profile update and the
 * care-plan recompute still run. The substrate refresh is NOT among them under newest-wins (owner ruling,
 * 2026-08-14; API finding E8, see `substrateAnchorKeptDay` below): `substrate_refreshed_on` re-anchors only
 * when the completion's day is newer than what is already stored, and stays put — `kept`, not re-anchored —
 * on exactly the duplicate-naming-an-older-day case this paragraph used to claim always moved it. The
 * neutral fallthrough
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
 * ---- THE POT DETAILS THAT WENT NOWHERE VISIBLE (F4, nothing-left-open code review, 2026-08-14; AMENDED
 * F5, 2026-08-15) -------------------------------------------------------------------------------------
 *
 * A REPOT completion carries the NEW pot's diameter and soil mix. When the day it names is older than the
 * stored anchor, the profile write is skipped — the event does not describe the pot's CURRENT fill.
 *
 * ⚠️ F5 AMENDMENT (owner ruling, 2026-08-15) — THE `already-recorded-on-day` STATUS GATE IS GONE. The
 * original F4 ruling (kept below for the record) reasoned that a NON-duplicate refused day "loses nothing"
 * because the values ride on the CareEvent's own payload — true, and not the whole story: that payload has
 * no surface the owner can read on this app, so a value that survives only there is, to him, a value that
 * vanished. The visible profile still shows the OLD diameter either way. So the sentence now fires whenever
 * the server's own flag is set, regardless of whether the write was a duplicate — the flag itself already
 * carries that distinction server-side (see the shared contract's own doc-comment,
 * `@retaxmaster/my-plants-species-schema`'s `care-outcome.ts`, for exactly which combinations set it).
 *
 * ---- THE ORIGINAL F4 REASONING (2026-08-14), for the record -----------------------------------------
 * "when that submission is ALSO a same-day duplicate, the one-per-day rule writes no `CareEvent` either. In
 * that one combination the values the owner typed have no home at all, and nothing on any surface said so.
 * THIS IS NOT THE RARE BRANCH. It is finding E8's own measured 197-day case — a duplicate naming a stale
 * day — which is the shape an owner actually produces." F5 above is why the sentence no longer waits for
 * that second condition.
 *
 * So the sentence is written to stand ALONE: it names its own subject (the pot details), its own reason
 * (they describe an earlier repot) and the fact that makes it true (the plant already has a more recent
 * one). It is never a footnote to the anchor sentence, even though it renders after it.
 *
 * ⚠️ READ STRAIGHT OFF THE SERVER'S OWN FLAG — never re-derived from `status`/`otherEffectsApplied`/`task`.
 * That trio looks equivalent and is not: an owner may legitimately answer "I don't know" to BOTH fields, and
 * only the writer knows whether anything was supplied. The shared contract's own doc-comment
 * (`care-outcome.ts`) states why the flag exists rather than being inferred.
 *
 * `null` means "say nothing", exactly like the two readers above — including for an absent outcome, which is
 * an older API mid rolling deploy and never an assertion about the pot details.
 */
export const POT_DETAILS_DISCARDED_KEY = 'tasks.potDetailsDiscarded';

export function potDetailsDiscardedNoteKey(outcome: CareWriteOutcome | undefined): string | null {
  if (!outcome) return null;
  return outcome.potDetailsDiscarded ? POT_DETAILS_DISCARDED_KEY : null;
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
  potDetailsKey: string | null,
  t: (key: string, named?: Record<string, unknown>) => string,
  formatDay: (day: string) => string,
): string | null {
  const parts = [
    noteKey ? t(noteKey) : null,
    anchorDay ? t(SUBSTRATE_ANCHOR_KEPT_KEY, { date: formatDay(anchorDay) }) : null,
    // F4 (2026-08-14) — THIRD and last, and that position is about reading order, not about importance.
    // The first two sentences answer "what happened to the record and to the clock"; this one answers "and
    // what happened to what I typed", which only makes sense once the owner knows a more recent repot
    // exists. It is a complete sentence in its own right precisely so the order cannot demote it: it names
    // its subject and its reason without depending on either sentence above.
    potDetailsKey ? t(potDetailsKey) : null,
  ].filter((part): part is string => !!part);
  return parts.length ? parts.join(' ') : null;
}
