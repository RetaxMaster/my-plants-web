import { shallowRef, type ShallowRef } from 'vue';

// An in-flight (or just-resolved-and-frozen) REPOT mutation attempt: the evaluation submit and the
// Done-form confirm each track a SEPARATE flow (`useRepotAttempt('evaluation')` / `useRepotAttempt('done')`
// below), and each flow tracks ONE entry PER PLANT (U1), not one attempt total.
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
//
// `error` (W2) is the mutation-FAILURE state for this attempt, and it lives HERE — on the attempt itself —
// rather than on a page-level flag, precisely so it cannot belong to the wrong plant OR the wrong flow by
// construction: a computed reading `attemptFor(theCurrentlyShownPlantId)` can only ever surface THIS
// attempt's own failure, never another plant's (a page-level `repotError` boolean, shared by every plant
// card, showed plant B's failure on plant A's reopened modal) nor another flow's (the same page-level flag
// was ALSO shared between the evaluation submit and the Done confirm). This is distinct from a LOADER
// failure (the repot-signs fetch, the Done form's profile prefetch) — those have no attempt to hang off of
// (they run BEFORE a key is ever minted) and stay page-scoped, exactly as before.
export interface RepotAttempt<TBody> {
  plantId: string;
  key: string;
  body: TBody;
  submitting: boolean;
  error: boolean;
}

// X1. Wave 8 (W1) shared the KEY across renderers but left the TERMINAL OUTCOME — what to do once a
// request finally succeeds — local to whichever component's own try/catch happened to run it. That is the
// remaining race: the two renderers are never mounted at the same time (separate routes), but a departed
// page's in-flight PROMISE keeps running after the owner navigates away. Reachable case: the owner confirms
// a Done on the Today page, then navigates to the plant's detail page before the request settles. The
// detail page sees the shared outstanding key (W1) and can open its own Done form frozen, resuming it. The
// Today request then succeeds: ITS OWN handler deletes the shared attempt and calls ONLY Today's now-dead
// `refresh()` — the detail page's `doneAttempt` computed goes null (the map entry is gone), so its still-
// open form silently UNFREEZES, while its own care/history/profile were never refreshed. Confirming again
// from that stale, unfrozen UI mints a FRESH key and the server records the SAME repot a SECOND time, with
// the owner never having chosen "start over".
//
// The fix: `resolveSuccess` below — the ONLY function that ever clears a live attempt on success — ALSO
// publishes a per-flow, module-scope COMPLETION signal naming the plant that just completed (and, for a flow
// that has one, the result — the evaluation flow's verdict; the Done flow has none). Both renderers `watch`
// the SAME signal (via the `completion` ref returned below), so whichever one is mounted when the request
// finally settles — the originator or a later one — reacts to the identical event. `seq` is a module-level
// monotonic counter bumped on every publish, so a SECOND completion for the SAME plant (a later, wholly
// separate attempt) is always its own distinguishable event for a watcher that fires on every change, never
// silently conflated with the first just because the fields look alike.
//
// `invalidate` (the owner's explicit "start over") deliberately never publishes a completion — abandoning an
// attempt is not completing it, and conflating the two would let a "start over" masquerade as a success to
// whichever renderer is watching.
export interface RepotCompletion<TResult = void> {
  plantId: string;
  seq: number;
  result: TResult;
}

// W1. `useRepotAttempt(flowKey)` used to create a brand-new Map every time it was CALLED, so
// `pages/index.vue` (ONE modal instance for the whole Today list) and `PlantDetail.vue` (the second
// renderer of the identical flows) each ended up owning their OWN, component-lifetime-scoped store — two
// separate maps for what is supposed to be ONE outstanding attempt per plant. The reachable defect: a Done
// request commits on the server but its response is lost; the owner closes the modal (still frozen, key
// outstanding) and navigates from Today to that plant's detail page. Today's component unmounts — taking
// its OWN copy of the key and body down with it — so PlantDetail's `hasKeyFor()` reads false, confirming
// mints a FRESH key, and the server records a SECOND, non-deduplicated REPOT completion, without the owner
// ever choosing "start over".
//
// The fix: the Map itself now lives at MODULE scope, ONE per flow key ('evaluation' | 'done'), not one per
// `useRepotAttempt()` call. `useRepotAttempt('evaluation')` and `useRepotAttempt('done')` are thin handles
// onto those two module-level stores — every caller asking for the same flow key (pages/index.vue AND
// PlantDetail.vue) reads and writes the SAME Map, so an attempt started on one renderer is visible, and
// resumable, on the other. Switching renderers is no longer a reason to lose an outstanding key.
//
// SSR SAFETY (load-bearing, do not regress): a module-level singleton is shared across every request the
// Node server ever handles, not scoped to one visitor — so the WRITE functions below (`begin`,
// `resolveSuccess`, `resolveFailure`, `invalidate`) must only ever run from a CLIENT event handler (a click
// callback fired in the browser), never from a component's `setup()` body or any other code path the server
// executes while rendering a request. That is already structurally true today: every call site is inside an
// `onClick`/`@submit`/`@confirm` handler in `pages/index.vue`/`PlantDetail.vue`, never invoked at setup-time
// — keep it that way. The READ functions (`attemptFor`, `hasKeyFor`, `isLive`) are safe to read from
// anywhere (including during SSR), since a store nothing ever writes to on the server simply reads back
// empty.
type FlowKey = 'evaluation' | 'done';
type AnyAttempt = RepotAttempt<unknown>;
type AnyCompletion = RepotCompletion<unknown>;

const flowStores: Partial<Record<FlowKey, ShallowRef<ReadonlyMap<string, AnyAttempt>>>> = {};
// X1: one completion signal per flow key, same module-scope-per-flow shape as `flowStores` above — every
// caller asking for the same flow key (Today, the plant detail page) watches the SAME signal.
const completionStores: Partial<Record<FlowKey, ShallowRef<AnyCompletion | null>>> = {};
let completionSeq = 0;

function storeFor(flowKey: FlowKey): ShallowRef<ReadonlyMap<string, AnyAttempt>> {
  const existing = flowStores[flowKey];
  if (existing) return existing;
  const created = shallowRef<ReadonlyMap<string, AnyAttempt>>(new Map());
  flowStores[flowKey] = created;
  return created;
}

function completionStoreFor(flowKey: FlowKey): ShallowRef<AnyCompletion | null> {
  const existing = completionStores[flowKey];
  if (existing) return existing;
  const created = shallowRef<AnyCompletion | null>(null);
  completionStores[flowKey] = created;
  return created;
}

// TEST-ONLY. A module-scope store is a shared-state hazard across test CASES within the same test file (the
// module is imported once and cached, so its state otherwise leaks from one `it()` into the next) — this
// resets every flow's attempt store AND completion signal back to empty/null. Call it from a `beforeEach` in
// any test file that mounts a component using this composable. Never called from application code.
export function __resetRepotAttemptStoresForTests(): void {
  for (const key of Object.keys(flowStores) as FlowKey[]) {
    flowStores[key] = shallowRef(new Map());
  }
  for (const key of Object.keys(completionStores) as FlowKey[]) {
    completionStores[key] = shallowRef(null);
  }
}

export function useRepotAttempt<TBody, TResult = void>(flowKey: FlowKey) {
  const attempts = storeFor(flowKey) as unknown as ShallowRef<ReadonlyMap<string, RepotAttempt<TBody>>>;
  const completion = completionStoreFor(flowKey) as unknown as ShallowRef<RepotCompletion<TResult> | null>;

  // Starts (or resumes) an attempt for `plantId`. Reuses the CURRENT key AND the CURRENT stored `body` when
  // an attempt is already outstanding for this plant (a same-plant retry must reuse the same idempotency
  // key AND the same request envelope — U2), mints a fresh key and snapshots the PASSED-IN `body` otherwise.
  // The caller must ALWAYS send `attempt.body` (never the `body` it just passed in) — on a resume, those two
  // are deliberately different: the second one is what a fresh recompute produced just now (e.g. a NEW
  // `occurredOn` past midnight, or a NEW `evaluationId` after an intervening `refresh()`), and the whole
  // point of freezing the envelope is that the retry ignores it and resends the ORIGINAL.
  //
  // `error` is always reset to `false` here (W2) — starting (or retrying) an attempt means a fresh in-flight
  // request, so any PREVIOUS failure this same attempt carried must stop being displayed the instant a new
  // submit begins, whether this is the plant's first attempt or its fifth retry.
  function begin(plantId: string, body: TBody): RepotAttempt<TBody> {
    const existing = attempts.value.get(plantId);
    const next: RepotAttempt<TBody> = existing
      ? { plantId, key: existing.key, body: existing.body, submitting: true, error: false }
      : { plantId, key: crypto.randomUUID(), body, submitting: true, error: false };
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

  // Called on SUCCESS: removes `candidate`'s plant entry entirely (key + body + submitting + error together)
  // IFF `candidate` is still live — a stale/abandoned attempt's own late success must never touch a newer
  // attempt's state, for this plant OR any other.
  //
  // X1: this is also the ONLY place a completion is published — and it happens ONLY inside the `isLive`
  // branch, so a stale/superseded attempt's late success (isLive false) publishes NOTHING and no watcher
  // anywhere ever fires for it, exactly like it never touches the attempt map above. `result` is the flow's
  // terminal payload where one exists (the evaluation verdict); flows with nothing to carry (Done) simply
  // never pass it, and it reads back as `undefined`.
  function resolveSuccess(candidate: RepotAttempt<TBody>, result?: TResult): void {
    if (!isLive(candidate)) return;
    const nextMap = new Map(attempts.value);
    nextMap.delete(candidate.plantId);
    attempts.value = nextMap;
    completionSeq += 1;
    completion.value = { plantId: candidate.plantId, seq: completionSeq, result: result as TResult };
  }

  // Called on FAILURE: marks not-submitting AND errored, but KEEPS the key AND the stored body, IFF
  // `candidate` is still live — a lost-response retry must reuse both (the stable-idempotency-key rule, and
  // U2's whole-envelope freeze), so failure never clears either. Setting `error: true` HERE (W2), on the
  // attempt keyed by `candidate.plantId`, is what makes the failure state belong to exactly this plant and
  // this flow — a caller's `computed(() => attemptFor(theCurrentlyShownPlantId).error)` can never read
  // another plant's or another flow's failure, because there is no shared flag left to leak through.
  function resolveFailure(candidate: RepotAttempt<TBody>): void {
    if (!isLive(candidate)) return;
    const nextMap = new Map(attempts.value);
    nextMap.set(candidate.plantId, { ...candidate, submitting: false, error: true });
    attempts.value = nextMap;
  }

  // Unconditionally discards whatever attempt is outstanding for THIS plant — used only for the owner's
  // explicit "start over" escape hatch. Per-plant and explicit on purpose (U1): opening a DIFFERENT plant's
  // card is no longer a reason to invalidate anything, so the only caller of this function now is the
  // owner's own choice to abandon their OWN outstanding key.
  //
  // X1: deliberately does NOT publish a completion. An explicit "start over" abandons the attempt — it does
  // not complete it — and a watcher reacting to this as if it were a success would be exactly backwards.
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
  // reactive to every mutation above, since each one reassigns `attempts.value` to a new Map. Because W1
  // hoisted the store to module scope, this same computed now also stays correct across a NAVIGATION between
  // the two renderers (Today ↔ plant detail), not just across a plant switch within one of them.
  function attemptFor(plantId: string | null): RepotAttempt<TBody> | null {
    return plantId ? attempts.value.get(plantId) ?? null : null;
  }

  return { attempts, completion, begin, isLive, resolveSuccess, resolveFailure, invalidate, hasKeyFor, attemptFor };
}
