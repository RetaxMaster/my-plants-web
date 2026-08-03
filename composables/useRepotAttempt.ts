import { shallowRef, watch, type ShallowRef } from 'vue';

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
// records a per-flow, module-scope COMPLETION naming the plant that just completed (and, for a flow that has
// one, the result — the evaluation flow's verdict; the Done flow has none). Both renderers consume the SAME
// per-flow record stream through `subscribeCompletions` below, so whichever one is mounted when the request
// finally settles — the originator or a later one — handles the identical record. `seq` is a module-level
// monotonic counter bumped on every publish, so a SECOND completion for the SAME plant (a later, wholly
// separate attempt) is always its own distinguishable record, never conflated with the first just because
// the fields look alike. (Wave 9 published into a single latest-value ref; R11-1 below is why that shape had
// to go, and what replaced it.)
//
// `invalidate` (the owner's explicit "start over") deliberately never publishes a completion — abandoning an
// attempt is not completing it, and conflating the two would let a "start over" masquerade as a success to
// whichever renderer is watching.
//
// R11-1 — WHY THIS IS A LOG AND NOT A "LATEST COMPLETION" REF, and why that distinction is the whole design.
// From wave 9 through wave 10 the completion was published into a SINGLE latest-value `shallowRef`, and every
// renderer read it either through a `watch` or through a one-shot catch-up. Both readers can only ever observe
// the value that happens to be sitting in the slot when they look — so two completions of the SAME flow
// landing between two observations leave only the second one observable, and the first is gone with no trace.
// That is not a hypothetical: measured directly against this composable, two `resolveSuccess` calls in
// back-to-back microtasks (exactly what two in-flight requests settling from one network tick produce) fire a
// registered watcher ONCE, for the second plant only. The consequence is the duplicate-write hole every wave
// since W1 has been chasing: `PlantDetail`, pinned to the FIRST plant, never learns that plant completed, so
// it never refreshes and never closes its form — while `resolveSuccess` has already deleted the attempt, so
// the form silently unfreezes and confirming again mints a FRESH idempotency key over data the server has
// already written.
//
// Ten rounds of this review patched a NOTIFICATION scheme — who owns the refresh, had the subscriber
// registered yet, does the watcher's baseline swallow the signal — and each patch relocated the hazard instead
// of removing it. The structural move is to stop treating a completion as an EVENT that must reach a live
// listener at the right instant, and treat it as an ordered RECORD that is still there whenever a reader gets
// around to looking. A reader cannot miss an entry in a log: it asks "what has happened since the point I last
// knew about?", and the answer is the same whether it asks immediately, one microtask later, or after a
// route transition's worth of awaits. Every question the old scheme kept getting wrong — subscriber
// existence, the async-setup gap, watcher baselines, burst coalescing — is not answered better here, it stops
// being a question. A guard is code that can be wrong; a removed possibility cannot.
export interface RepotCompletion<TResult = void> {
  plantId: string;
  seq: number;
  result: TResult;
}

// R11-1. How many completions each flow's log retains. A record is three small fields and the log is per
// browser session, so the cap exists to bound unbounded growth, not as a tuning knob: reaching it needs 50
// SUCCESSFUL repot mutations in one uninterrupted page session, each a deliberate owner action.
//
// R12-1 — WHAT TRIMMING CAN AND CANNOT DO, stated precisely because the earlier version of this comment
// claimed more than the code enforced. Trimming drops the OLDEST records. In the overwhelmingly common case
// every reader has already handled those, so nothing is lost. But a reader BLOCKED IN ITS OWN ASYNC SETUP
// while more than 50 completions land has NOT handled them, and those records are then gone — the log cannot
// deliver what it no longer holds. That case is NOT waved away as unrealistic: a silently dropped record is
// exactly the class this whole design exists to delete, and "it will not fire" is a reason it will not fire,
// never a reason it may fail quietly. So the drop is RECORDED (`completionDropped`) and such a reader is
// handed an explicit GAP signal instead of a silent skip — see `subscribeCompletions`.
const COMPLETION_LOG_LIMIT = 50;

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
// X1/R11-1: one completion LOG per flow key, same module-scope-per-flow shape as `flowStores` above — every
// caller asking for the same flow key (Today, the plant detail page) reads the SAME log. Ordered oldest-first,
// append-only within the retention window, and reassigned (never mutated in place) on every append so a
// `watch` sees it.
const completionLogs: Partial<Record<FlowKey, ShallowRef<readonly AnyCompletion[]>>> = {};
// R12-1: the newest `seq` this flow has ever DROPPED off the front of its log, or 0 if it never has. A
// subscriber whose cursor is older than this has provably missed records that no longer exist to be
// delivered — the one case the log alone cannot recover — so it is told, rather than silently skipped.
const completionDropped: Partial<Record<FlowKey, number>> = {};
// Monotonic across BOTH flows: a cursor is only ever compared against seq values drawn from its own flow's
// log, so sharing the counter costs nothing and makes every record in the session globally orderable. It is
// deliberately NOT reset by the test helper below — monotonicity is the property that makes a cursor
// meaningful, and a counter that restarts could make a NEW record compare as older than a handled one.
let completionSeq = 0;

function storeFor(flowKey: FlowKey): ShallowRef<ReadonlyMap<string, AnyAttempt>> {
  const existing = flowStores[flowKey];
  if (existing) return existing;
  const created = shallowRef<ReadonlyMap<string, AnyAttempt>>(new Map());
  flowStores[flowKey] = created;
  return created;
}

function completionLogFor(flowKey: FlowKey): ShallowRef<readonly AnyCompletion[]> {
  const existing = completionLogs[flowKey];
  if (existing) return existing;
  const created = shallowRef<readonly AnyCompletion[]>([]);
  completionLogs[flowKey] = created;
  return created;
}

// The seq of the newest record currently in `log`, or 0 when the log is empty. This is what a reader captures
// as its cursor: "everything up to here either happened before I existed, or I have already handled it".
function headSeq(log: ShallowRef<readonly AnyCompletion[]>): number {
  const entries = log.value;
  return entries.length ? entries[entries.length - 1]!.seq : 0;
}

// TEST-ONLY. A module-scope store is a shared-state hazard across test CASES within the same test file (the
// module is imported once and cached, so its state otherwise leaks from one `it()` into the next) — this
// resets every flow's attempt store AND completion log back to empty. Call it from a `beforeEach` in
// any test file that mounts a component using this composable. Never called from application code.
export function __resetRepotAttemptStoresForTests(): void {
  for (const key of Object.keys(flowStores) as FlowKey[]) {
    flowStores[key] = shallowRef(new Map());
  }
  for (const key of Object.keys(completionLogs) as FlowKey[]) {
    completionLogs[key] = shallowRef([]);
  }
  for (const key of Object.keys(completionDropped) as FlowKey[]) {
    completionDropped[key] = 0;
  }
  // `completionSeq` is deliberately NOT reset — see its declaration.
}

export function useRepotAttempt<TBody, TResult = void>(flowKey: FlowKey) {
  const attempts = storeFor(flowKey) as unknown as ShallowRef<ReadonlyMap<string, RepotAttempt<TBody>>>;
  const completionLog = completionLogFor(flowKey) as unknown as ShallowRef<readonly RepotCompletion<TResult>[]>;

  // R11-1. THE CURSOR, captured HERE and not by the caller. A renderer must know which completions predate
  // it, so that it reconciles the ones published during its own async setup and ignores the ones that were
  // already history before it mounted. Getting that right requires reading the log's head BEFORE the
  // component's first top-level `await` — and for three waves that requirement lived in each renderer as a
  // hand-written line plus a comment telling the next author not to move it: four copies (two renderers x two
  // flows), any of which a refactor could reorder past an await with nothing failing. Round 10 found two of
  // those copies had already diverged.
  //
  // R12-3 — WHAT THIS PLACEMENT DOES AND DOES NOT GUARANTEE, corrected: an earlier version of this comment
  // said the ordering was true "BY CONSTRUCTION" and that a renderer "can no longer get it wrong". That was
  // FALSE and it is worth saying so plainly. Nothing in this API forces `useRepotAttempt()` to be called
  // before the caller's first `await`, and nothing forces a caller holding a handle to subscribe at all.
  // **It is true BY CONVENTION**, and the convention is load-bearing: both renderers call this at the top of
  // `<script setup>` because that is where a flow's handles come from. WHAT WOULD BREAK IT: moving a
  // `useRepotAttempt(...)` call below a top-level `await`, or introducing a renderer that awaits before
  // asking for its handles — either would capture a cursor that has already advanced past completions it
  // still needed to reconcile, and no test would fail.
  //
  // What this placement DOES earn, and all it needs to earn: there is exactly ONE place the cursor is read
  // instead of four, so the convention has one site to check rather than four to keep in step.
  const cursorAtSetup = headSeq(completionLog as unknown as ShallowRef<readonly AnyCompletion[]>);

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
    // R11-1: APPEND to the log — never overwrite a slot. Two completions landing back-to-back (two in-flight
    // requests settling from one network tick) are now two records, so a reader that looks once afterwards
    // still sees BOTH. Reassigned to a new array, never pushed in place, so `watch` observes the change.
    const nextLog = [...completionLog.value, { plantId: candidate.plantId, seq: completionSeq, result: result as TResult }];
    if (nextLog.length > COMPLETION_LOG_LIMIT) {
      // R12-1: remember the newest seq being discarded, so a reader that never saw it can be TOLD.
      const discarded = nextLog.slice(0, nextLog.length - COMPLETION_LOG_LIMIT);
      completionDropped[flowKey] = discarded[discarded.length - 1]!.seq;
      completionLog.value = nextLog.slice(-COMPLETION_LOG_LIMIT);
    } else {
      completionLog.value = nextLog;
    }
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

  // R11-1. THE ONE WAY A RENDERER CONSUMES COMPLETIONS. Call it from setup — after the top-level awaits is
  // both allowed and expected, because the handler needs the data handles those awaits produce, and the
  // cursor that makes late registration safe was already taken above.
  //
  // It does three things in one place, so the two renderers cannot implement them differently from each
  // other (they did: the previous shape had each renderer hand-write a baseline, a catch-up block and a
  // `watch`, four times over, and round 10 found the two copies had diverged on whether the refresh was
  // gated):
  //   1. DRAIN — hand `handler` every record newer than this consumer's cursor, OLDEST FIRST. On a first
  //      call that is the async-setup gap's backlog; on a `watch` firing it is whatever was just appended,
  //      which is more than one record whenever two completions coalesced into a single flush.
  //   2. ADVANCE THE CURSOR FIRST, before invoking any handler, so a handler that itself causes an append is
  //      never re-delivered a record it is already processing. A record appended DURING a pass is delivered
  //      by the NEXT pass, which the already-registered watcher schedules (R12-2 / R13-1).
  //   2b. REPORT A GAP (R12-1) when this reader's cursor predates the newest record the log has DROPPED.
  //      `onGap` fires once per gap, and the caller's correct response is to reconcile its data
  //      unconditionally, because it cannot know which plants it missed. A gap is possible for ANY reader
  //      whose cursor falls behind the trim point — most plausibly one blocked in its own async setup, but
  //      an already-subscribed reader is not exempt, and the detector does not distinguish them.
  //   3. WATCH for later appends, with the SAME drain function — so the catch-up path and the live path are
  //      not two implementations that can disagree; they are one function called twice.
  //
  // `{ immediate: true }` is not needed and not used: the explicit `drain()` below IS the immediate pass,
  // and expressing it explicitly keeps the ordering visible — SUBSCRIBE, then drain, with no await between
  // (R14-3: this said "drain, then subscribe" after R13-1 reversed the two, which is the stale-comment class
  // this review keeps finding; the order is load-bearing and the reasoning is at the `watch` call itself).
  // Handlers may be async; their promise is deliberately not awaited here — a consumer's refresh must never
  // be able to delay another consumer's, and Nuxt's `refresh()` cannot reject (it catches into `error` and
  // resolves), so there is nothing to swallow.
  function subscribeCompletions(
    handler: (completion: RepotCompletion<TResult>) => void,
    onGap?: () => void,
  ): void {
    let handledSeq = cursorAtSetup;
    // R14-1 — REFUSED, proven against the real code rather than assumed. A reviewer raised that during SSR
    // Vue returns a no-op handle for a non-immediate watcher, so a record appended by a handler DURING the
    // initial drain could not be picked up by a later pass. True in isolation, and unreachable here: reaching
    // that state needs a completion to already exist during SSR, and nothing writes this log on the server —
    // all four `resolveSuccess` call sites across both renderers sit inside `onEvaluationSubmit` /
    // `onRepotDoneConfirm`, which are client event handlers (see the SSR SAFETY note at the top of this
    // file). On the server the log is empty, so the initial drain delivers nothing, no handler runs, and
    // there is no re-entrant append to lose.
    //
    // R12-2 / R13-1 — WHY THE WATCHER IS REGISTERED FIRST, AND WHY EACH PASS READS A FIXED SNAPSHOT. Two
    // defects shaped this, in order, and the current form is what closes both without a guard:
    //
    // R12-2: the original drained ONCE and then registered the watcher. A handler that itself caused a new
    // completion appended it while no watcher yet existed, and the watcher — registered right after and
    // deliberately not `immediate` — then took that record as its starting value and never fired for it.
    // Measured: `PROBE delivered: ["A"]`, with B lost.
    // R13-1: the first fix re-drained in a `for (;;)` until the cursor reached the head. That chases a MOVING
    // head: a handler appending on every invocation is handled, appends again, is handled again — and the
    // loop never returns. The comment claiming it "TERMINATES because `seq` is strictly monotonic" was wrong,
    // and wrong in an instructive way: monotonicity buys PROGRESS, not a finite number of iterations.
    //
    // Registering `watch` BEFORE the first drain makes the loop unnecessary. Each drain is then ONE bounded
    // pass over a snapshot taken at its start; anything a handler appends during that pass mutates the ref
    // while a watcher is already listening, so it arrives on a LATER pass instead of being chased
    // synchronously. Vue watchers are asynchronous (`pre` flush), so the initial drain below completes before
    // any watcher callback and the two cannot interleave.
    //
    // R14-2 — WHAT THIS DOES AND DOES NOT GUARANTEE, because the previous wording ("always returns", "the
    // next flush") claimed more than the code can: ASSUMING EACH HANDLER INVOCATION RETURNS, one drain
    // invokes the handler at most once per entry in its fixed snapshot and then returns — the snapshot bounds
    // the pass, it cannot bound an arbitrary handler. And a `pre` watcher that mutates its own source is
    // eligible for RECURSIVE scheduling: a handler that appends on every invocation will keep requeueing the
    // job and eventually trip Vue's own recursive-update guard. That is a loud, bounded failure rather than
    // the silent infinite loop R13-1 found, which is the improvement being claimed here — not immunity.
    const drain = () => {
      // R12-1: records this reader needed but that were trimmed away before it looked. There is nothing left
      // to deliver, so the only honest thing is to say so — never to skip past it silently.
      const droppedThrough = completionDropped[flowKey] ?? 0;
      if (handledSeq < droppedThrough) {
        handledSeq = droppedThrough;
        onGap?.();
      }
      // R13-1: read the log ONCE per pass. `pending` is fixed before any handler runs, so a handler's own
      // append cannot extend this pass — it schedules the next one through the watcher above.
      const snapshot = completionLog.value;
      const pending = snapshot.filter((entry) => entry.seq > handledSeq);
      if (!pending.length) return;
      handledSeq = pending[pending.length - 1]!.seq;
      for (const entry of pending) handler(entry);
    };
    watch(completionLog, drain);
    drain();
  }

  return { attempts, begin, isLive, resolveSuccess, resolveFailure, invalidate, hasKeyFor, attemptFor, subscribeCompletions };
}
