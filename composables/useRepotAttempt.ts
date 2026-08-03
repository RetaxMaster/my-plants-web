import { shallowRef } from 'vue';

// An in-flight (or just-resolved-and-frozen) REPOT mutation attempt: the evaluation submit and the
// Done-form confirm each track a SEPARATE `useRepotAttempt()` instance, and each instance now tracks ONE
// entry PER PLANT (U1 — see below), not one attempt total.
//
// `body` is the WHOLE request envelope the server needs to replay the SAME submission on a retry — for the
// evaluation flow that is the submitted `RepotEvaluationSubmit`; for the Done flow it is
// `{ occurredOn, payload }` (`completeRepot`'s two non-plantId, non-key arguments bundled together). It is
// snapshotted ONCE, the moment the key is minted, and never recomputed afterwards (U2 — see `begin` below):
// freezing only the VISIBLE form fields is not enough, because `evaluationId` is read fresh off the live
// task list at confirm time and `occurredOn` can be read fresh off the clock at confirm time — either one
// drifting between the original submission and a retry would send the SAME idempotency key with a
// DIFFERENT body, which the server's idempotency interceptor answers 422 FOREVER (it compares the whole
// body, not just the key). Freezing the envelope on the attempt, once, structurally closes that instead of
// depending on the caller never recomputing anything.
export interface RepotAttempt<TBody> {
  plantId: string;
  key: string;
  body: TBody;
  submitting: boolean;
}

// U1. Before this, a single `attempt` slot was shared by EVERY plant card on `pages/index.vue` (one modal
// instance renders for the whole Today list) and — per plant — by `PlantDetail.vue`. Switching to a
// DIFFERENT plant's card while an attempt was outstanding had to unconditionally discard whatever was in
// the slot, on the stated premise that carrying one plant's key into another plant's request body would
// 422 forever. That trade only existed because there was ONE slot: discarding the outstanding attempt was
// the price of never crossing keys between plants. The reachable defect it left open: plant A's Done
// completion commits on the server, the response is lost, the key is kept and the form freezes; the owner
// opens plant B's Done form; A's ONLY replay key is discarded SILENTLY — without the owner ever choosing
// "start over" — and the next confirm on A (after returning to its still-stale card) mints a FRESH key,
// so the server records a SECOND, non-deduplicated REPOT completion.
//
// The fix: key the attempts by `plantId` in a Map instead of holding one. Opening a different plant's card
// no longer touches ANY other plant's entry — there is nothing to discard, so there is nothing for a later
// "start over" to have abandoned by accident, and a key can still never cross into another plant's body
// because each plant's `begin()` only ever reads/writes its OWN map entry.
//
// The Map itself is held in a `shallowRef`, and every mutation below REPLACES it with a new Map (copying
// the untouched entries by reference, replacing only the changed plant's entry) rather than mutating the
// existing Map in place. Two reasons, both load-bearing:
//   1. A plain `Map#set`/`Map#delete` call does not trigger Vue reactivity on its own — `shallowRef` only
//      reacts to whole-value REASSIGNMENT, so every write path here must assign a new Map to `attempts.value`
//      for a computed reading it (`attemptFor`, wrapped by each renderer) to re-run.
//   2. `shallowRef`, deliberately NOT `ref`: `ref()` on the Map (or on an attempt object) would auto-wrap it
//      in a reactive Proxy, so a caller's captured reference would never `===` the value stored in the map
//      again — the identity check `isLive` below depends on would then ALWAYS read "stale", even for the
//      the very attempt that just resolved. Copying the Map on every write (rather than mutating it) keeps every
//      UNCHANGED plant's attempt object at the exact same reference it always was, so a candidate captured
//      before the write still `===` the (copied-over) entry after it. This cost a previous executor a
//      debugging round on the single-slot version of this file; do not reintroduce `ref` here.
export function useRepotAttempt<TBody>() {
  const attempts = shallowRef<ReadonlyMap<string, RepotAttempt<TBody>>>(new Map());

  // Starts (or resumes) an attempt for `plantId`. Reuses the CURRENT key AND the CURRENT stored `body` when
  // an attempt is already outstanding for this plant (a same-plant retry must reuse the same idempotency
  // key AND the same request envelope — U2), mints a fresh key and snapshots the PASSED-IN `body` otherwise.
  // The caller must ALWAYS send `attempt.body` (never the `body` it just passed in) — on a resume, those two
  // are deliberately different: the second one is what a fresh recompute produced just now (e.g. a NEW
  // `occurredOn` past midnight, or a NEW `evaluationId` after an intervening `refresh()`), and the whole
  // point of freezing the envelope is that the retry ignores it and resends the ORIGINAL.
  function begin(plantId: string, body: TBody): RepotAttempt<TBody> {
    const existing = attempts.value.get(plantId);
    const next: RepotAttempt<TBody> = existing
      ? { plantId, key: existing.key, body: existing.body, submitting: true }
      : { plantId, key: crypto.randomUUID(), body, submitting: true };
    const nextMap = new Map(attempts.value);
    nextMap.set(plantId, next);
    attempts.value = nextMap;
    return next;
  }

  // True iff `candidate` is still the live attempt for ITS OWN plant — reference-identity comparison (never
  // re-derive this from `plantId`/`key` equality: two logically-equal-looking attempts must still be told
  // apart when one has been superseded, which is exactly the case identity, not equality, is for).
  function isLive(candidate: RepotAttempt<TBody>): boolean {
    return attempts.value.get(candidate.plantId) === candidate;
  }

  // Called on SUCCESS: removes `candidate`'s plant entry entirely (key + body + submitting together) IFF
  // `candidate` is still live — a stale/abandoned attempt's own late success must never touch a newer
  // attempt's state, for this plant OR any other.
  function resolveSuccess(candidate: RepotAttempt<TBody>): void {
    if (!isLive(candidate)) return;
    const nextMap = new Map(attempts.value);
    nextMap.delete(candidate.plantId);
    attempts.value = nextMap;
  }

  // Called on FAILURE: marks not-submitting but KEEPS the key AND the stored body, IFF `candidate` is still
  // live — a lost-response retry must reuse both (the stable-idempotency-key rule, and U2's whole-envelope
  // freeze), so failure never clears either.
  function resolveFailure(candidate: RepotAttempt<TBody>): void {
    if (!isLive(candidate)) return;
    const nextMap = new Map(attempts.value);
    nextMap.set(candidate.plantId, { ...candidate, submitting: false });
    attempts.value = nextMap;
  }

  // Unconditionally discards whatever attempt is outstanding for THIS plant — used only for the owner's
  // explicit "start over" escape hatch. Per-plant and explicit on purpose (U1): opening a DIFFERENT plant's
  // card is no longer a reason to invalidate anything, so the only caller of this function now is the
  // owner's own choice to abandon their OWN outstanding key.
  function invalidate(plantId: string): void {
    if (!attempts.value.has(plantId)) return;
    const nextMap = new Map(attempts.value);
    nextMap.delete(plantId);
    attempts.value = nextMap;
  }

  // Resume check for a flow's "open" step: is there an outstanding key for THIS plantId already? True means
  // "resume — keep the key, the stored body, and any prior error", false means "fresh attempt".
  function hasKeyFor(plantId: string): boolean {
    return attempts.value.has(plantId);
  }

  // The attempt currently outstanding for `plantId`, or null when there is none (including when `plantId`
  // itself is null — the form has nothing open yet). Callers wrap this in their OWN `computed(() =>
  // attemptFor(theirCurrentPlantIdRef.value))` so the renderer always reads the entry for whichever plant
  // its form/modal is currently showing (`pages/index.vue`'s `evaluationPlantId`/`doneFormPlantId`,
  // `PlantDetail.vue`'s single `id`) — reading `attempts.value` inside that computed is what makes it
  // reactive to every mutation above, since each one reassigns `attempts.value` to a new Map.
  function attemptFor(plantId: string | null): RepotAttempt<TBody> | null {
    return plantId ? attempts.value.get(plantId) ?? null : null;
  }

  return { attempts, begin, isLive, resolveSuccess, resolveFailure, invalidate, hasKeyFor, attemptFor };
}
