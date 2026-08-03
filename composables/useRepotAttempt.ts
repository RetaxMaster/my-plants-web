import { shallowRef } from 'vue';

// A single in-flight (or just-resolved-and-frozen) REPOT mutation attempt: the evaluation submit and the
// Done-form confirm each track ONE of these. `plantId` scopes an attempt to the plant it belongs to (on
// pages/index.vue, ONE modal instance is shared by every plant card, so a later click on a DIFFERENT
// plant must abandon — never clobber — whatever attempt was live); `key` is the stable idempotency key,
// minted lazily on the first submit and reused verbatim across retries of that SAME submission (NEVER
// content-derived — two genuinely separate submissions for one plant must not collapse into one);
// `submitting` is the in-flight flag the modal/form renders.
export interface RepotAttempt {
  plantId: string;
  key: string;
  submitting: boolean;
}

// Round-4 finding V1 (pages/index.vue) / round-5 finding V1 (its sibling, PlantDetail.vue — the SAME
// race survived there because the fix landed on only one of the two renderers, exactly the parallel-copy
// bug class this project names as its highest-yield): tracking `key` and `submitting` as two SEPARATE
// refs let a stale attempt's own `finally` clear `submitting` AFTER a newer attempt had already started —
// either because the stale attempt's plant/key pair no longer matched the live one (nothing else ever
// cleared its own flag either), or, once fixed for that case, because clearing the key first and only
// THEN awaiting `refresh()` let the stale attempt's bookkeeping clobber a NEWER attempt's flag the moment
// that late `refresh()` finally resolved. A SINGLE object, replaced/discarded in ONE write the instant it
// succeeds, fails, or the owner abandons the flow, is the fix: `key` and `submitting` can then never go
// out of sync with each other, because there is only ever one place either of them is written.
//
// `shallowRef`, deliberately NOT `ref`: `ref()` on an object auto-wraps it in a reactive Proxy, so a
// caller's captured reference would never `===` `attempt.value` again — the identity check `isLive` below
// depends on would then ALWAYS read "stale", even for the very attempt that just resolved. `shallowRef`
// tracks reactivity only on whole-value reassignment (exactly what every write here does — replace or
// null the whole object, never mutate a field in place), so a captured reference survives intact for
// comparison. This cost a previous executor a debugging round; do not reintroduce `ref` here.
//
// One `useRepotAttempt()` call tracks ONE flow (a component calls it twice — once for the evaluation
// submit, once for the Done-form confirm — exactly like it previously held two separate ref pairs).
export function useRepotAttempt() {
  const attempt = shallowRef<RepotAttempt | null>(null);

  // Starts (or resumes) an attempt for `plantId`: reuses the CURRENT key when one is already outstanding
  // for this SAME plant (a same-plant retry must reuse the same idempotency key), mints a fresh one
  // otherwise. Marks the returned object as the new live attempt in this same call. The caller must
  // capture the RETURNED object and use it for every subsequent `isLive`/`resolveSuccess`/`resolveFailure`
  // call on this request — never re-read `attempt.value` later, since it can be replaced or nulled out
  // from under an in-flight request by a newer attempt or an explicit invalidation.
  function begin(plantId: string): RepotAttempt {
    const reuseKey = attempt.value && attempt.value.plantId === plantId ? attempt.value.key : undefined;
    const next: RepotAttempt = { plantId, key: reuseKey ?? crypto.randomUUID(), submitting: true };
    attempt.value = next;
    return next;
  }

  // True iff `candidate` is still the live attempt — reference-identity comparison (never re-derive this
  // from `plantId`/`key` equality: two logically-equal-looking attempts must still be told apart when one
  // has been superseded, which is exactly the case identity, not equality, is for).
  function isLive(candidate: RepotAttempt): boolean {
    return attempt.value === candidate;
  }

  // Called on SUCCESS: discards the whole attempt (key + submitting together) IFF `candidate` is still
  // live — a stale/abandoned attempt's own late success must never touch a newer attempt's state.
  function resolveSuccess(candidate: RepotAttempt): void {
    if (attempt.value === candidate) attempt.value = null;
  }

  // Called on FAILURE: marks not-submitting but KEEPS the key, IFF `candidate` is still live — a lost-
  // response retry must reuse the same key (the stable-idempotency-key rule), so failure never clears it.
  function resolveFailure(candidate: RepotAttempt): void {
    if (attempt.value === candidate) attempt.value = { ...candidate, submitting: false };
  }

  // Unconditionally discards whatever attempt is live right now — used when the owner moves to a
  // different target (a different plant's card) or hits the explicit "start over" escape hatch. Nulling
  // the whole object in one write clears `submitting` too, so a still-true flag from an abandoned attempt
  // can never leak into whatever comes next.
  function invalidate(): void {
    attempt.value = null;
  }

  // Resume check for a flow's "open" step (mirrors the old `evaluationKey`/`doneKey` truthiness check): is
  // there an outstanding key for THIS plantId already? True means "resume — keep the key and any prior
  // error", false means "fresh attempt — invalidate whatever was there and reset the error".
  function hasKeyFor(plantId: string): boolean {
    return !!attempt.value && attempt.value.plantId === plantId;
  }

  return { attempt, begin, isLive, resolveSuccess, resolveFailure, invalidate, hasKeyFor };
}
