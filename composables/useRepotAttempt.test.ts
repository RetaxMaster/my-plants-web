// W1: `useRepotAttempt(flowKey)` used to create a BRAND-NEW Map every time it was CALLED, so
// `pages/index.vue` and `PlantDetail.vue` — two separate call sites for the identical 'evaluation'/'done'
// flows — each got their OWN, component-lifetime-scoped store. The fix hoists the store to MODULE scope,
// one per flow key, so every caller asking for the SAME flow key shares the SAME Map. These tests exercise
// the composable directly (no Vue component involved) to pin that guarantee at its source, independent of
// which renderer (Today page or plant detail) happens to be asking.
import { describe, it, expect, beforeEach } from 'vitest';
import { nextTick } from 'vue';
import { useRepotAttempt, __resetRepotAttemptStoresForTests } from './useRepotAttempt';

beforeEach(() => {
  __resetRepotAttemptStoresForTests();
});

describe('useRepotAttempt — W1: one module-scope store PER FLOW KEY, shared across every caller', () => {
  it('an attempt begun through ONE handle for a flow key is visible through a SECOND, independently ' +
    'obtained handle for the SAME flow key — the exact shape of pages/index.vue and PlantDetail.vue both ' +
    "calling useRepotAttempt('evaluation')", () => {
    // Two independent calls, exactly like pages/index.vue and PlantDetail.vue each calling
    // useRepotAttempt<RepotEvaluationSubmit>('evaluation') from their own <script setup>.
    const rendererA = useRepotAttempt<{ answer: string }>('evaluation');
    const rendererB = useRepotAttempt<{ answer: string }>('evaluation');

    const attempt = rendererA.begin('plant-1', { answer: 'no-signs' });

    // The SECOND handle reads the SAME entry — not null, not a separate/empty Map.
    const seenFromB = rendererB.attemptFor('plant-1');
    expect(seenFromB).not.toBeNull();
    expect(seenFromB!.key).toBe(attempt.key);
    expect(seenFromB!.body).toEqual({ answer: 'no-signs' });
    expect(rendererB.hasKeyFor('plant-1')).toBe(true);

    // A failure recorded through B is visible through A too — genuinely the SAME store, not a copy.
    rendererB.resolveFailure(seenFromB!);
    const seenAgainFromA = rendererA.attemptFor('plant-1');
    expect(seenAgainFromA!.error).toBe(true);
    expect(seenAgainFromA!.key).toBe(attempt.key); // same key survives, per the stable-idempotency-key rule
  });

  it("does NOT share state across DIFFERENT flow keys — 'evaluation' and 'done' stay two separate stores " +
    'even for the SAME plantId', () => {
    const evaluationHandle = useRepotAttempt<{ answer: string }>('evaluation');
    const doneHandle = useRepotAttempt<{ occurredOn: string }>('done');

    evaluationHandle.begin('plant-1', { answer: 'no-signs' });

    // The 'done' flow's own store for the SAME plantId is untouched — an evaluation attempt must never be
    // mistaken for an outstanding Done attempt, or vice versa.
    expect(doneHandle.hasKeyFor('plant-1')).toBe(false);
    expect(doneHandle.attemptFor('plant-1')).toBeNull();
  });

  it('a fresh renderer instance for the SAME flow key still resumes an attempt begun by an EARLIER instance ' +
    "— the shape of navigating Today → plant detail and back: the first renderer's component unmounts " +
    'entirely, and a brand-new useRepotAttempt() call must still see the outstanding attempt', () => {
    const todayPageInstance = useRepotAttempt<{ answer: string }>('evaluation');
    const attempt = todayPageInstance.begin('plant-1', { answer: 'no-signs' });
    todayPageInstance.resolveFailure(attempt); // fails and freezes — key kept, error set

    // "Today's component unmounts" is simulated by simply never touching `todayPageInstance` again and
    // obtaining a BRAND NEW handle, exactly as PlantDetail.vue's own <script setup> would on navigation.
    const plantDetailInstance = useRepotAttempt<{ answer: string }>('evaluation');
    expect(plantDetailInstance.hasKeyFor('plant-1')).toBe(true);
    const resumed = plantDetailInstance.attemptFor('plant-1');
    expect(resumed!.key).toBe(attempt.key);
    expect(resumed!.error).toBe(true);
    expect(resumed!.body).toEqual({ answer: 'no-signs' });
  });
});

describe('useRepotAttempt — W2: the mutation-failure state (`error`) lives on the attempt itself', () => {
  it('begin() always resets `error` to false — a retry (fresh or resumed) is a fresh in-flight request, ' +
    'never still displaying the PREVIOUS attempt\'s failure', () => {
    const handle = useRepotAttempt<{ v: number }>('done');
    const first = handle.begin('plant-1', { v: 1 });
    handle.resolveFailure(first);
    expect(handle.attemptFor('plant-1')!.error).toBe(true);

    // Retrying (begin() again for the SAME plant) must clear the error, even though the key/body are reused.
    const retried = handle.begin('plant-1', { v: 1 });
    expect(retried.error).toBe(false);
    expect(retried.key).toBe(first.key); // same key — a retry, not a fresh attempt
  });

  it('resolveFailure sets `error` ONLY on the candidate\'s own plant — a different plant\'s entry in the ' +
    'SAME flow store is untouched', () => {
    const handle = useRepotAttempt<{ v: number }>('done');
    const attemptA = handle.begin('plant-A', { v: 1 });
    handle.begin('plant-B', { v: 2 });

    handle.resolveFailure(attemptA);

    expect(handle.attemptFor('plant-A')!.error).toBe(true);
    expect(handle.attemptFor('plant-B')!.error).toBe(false);
  });

  it('resolveSuccess deletes the whole entry — a later attemptFor() reads null, never a stale error', () => {
    const handle = useRepotAttempt<{ v: number }>('done');
    const attempt = handle.begin('plant-1', { v: 1 });
    handle.resolveFailure(attempt);
    expect(handle.attemptFor('plant-1')!.error).toBe(true);

    // A fresh attempt (begin() again) that this time SUCCEEDS clears everything, including the error.
    const retried = handle.begin('plant-1', { v: 1 });
    handle.resolveSuccess(retried);
    expect(handle.attemptFor('plant-1')).toBeNull();
  });
});

describe('useRepotAttempt — X1/R11-1: completions are an ordered LOG drained through subscribeCompletions', () => {
  // Every test here consumes completions the ONLY way the renderers do — `subscribeCompletions`. There is no
  // second read path any more (the old `completion` ref is gone), so a test cannot pass against a seam the
  // product does not use.
  function collector<TResult>(handle: { subscribeCompletions: (h: (c: { plantId: string; seq: number; result: TResult }) => void) => void }) {
    const seen: { plantId: string; seq: number; result: TResult }[] = [];
    handle.subscribeCompletions((c) => { seen.push(c); });
    return seen;
  }

  it('resolveSuccess publishes a completion naming the plant and carrying the result, visible through a ' +
    'SECOND, independently obtained handle for the SAME flow key — the exact shape of pages/index.vue and ' +
    "PlantDetail.vue both consuming useRepotAttempt('evaluation')'s completions", async () => {
    const rendererA = useRepotAttempt<{ answer: string }, { verdict: string }>('evaluation');
    const rendererB = useRepotAttempt<{ answer: string }, { verdict: string }>('evaluation');
    const seenByB = collector(rendererB);

    expect(seenByB).toEqual([]); // nothing published yet

    const attempt = rendererA.begin('plant-1', { answer: 'no-signs' });
    rendererA.resolveSuccess(attempt, { verdict: 'REPOT' });
    await nextTick(); // the LIVE path is a watcher flush; the catch-up drain is the synchronous one

    // The SECOND handle receives the SAME completion — not silence, not a separate signal.
    expect(seenByB).toHaveLength(1);
    expect(seenByB[0]!.plantId).toBe('plant-1');
    expect(seenByB[0]!.result).toEqual({ verdict: 'REPOT' });
  });

  // R11-1 — THE REGRESSION THIS WHOLE REDESIGN EXISTS FOR. Under the previous single-latest-value ref this
  // was measured directly: two resolveSuccess calls in back-to-back microtasks delivered ONE event, for the
  // SECOND plant only, and plant A's completion was gone with no trace. On PlantDetail — pinned to plant A —
  // that meant no refresh and no modal close while A's attempt had already been deleted, so the form
  // unfroze and confirming again minted a fresh idempotency key over a write the server had already made.
  it('TWO completions of the same flow landing back-to-back are BOTH delivered, oldest first — a burst can ' +
    'never coalesce into "only the last one happened"', async () => {
    const handle = useRepotAttempt<{ v: number }, string>('done');
    const seen = collector(handle);

    const a = handle.begin('plant-A', { v: 1 });
    const b = handle.begin('plant-B', { v: 2 });

    // Two in-flight requests whose responses arrive from the same network tick: their continuations run in
    // two consecutive microtasks, which is strictly less time than a Vue watcher flush.
    await Promise.all([
      Promise.resolve().then(() => { handle.resolveSuccess(a, 'verdict-A'); }),
      Promise.resolve().then(() => { handle.resolveSuccess(b, 'verdict-B'); }),
    ]);
    await nextTick();

    expect(seen.map((c) => c.plantId)).toEqual(['plant-A', 'plant-B']);
    expect(seen.map((c) => c.result)).toEqual(['verdict-A', 'verdict-B']);
  });

  it('a subscriber that registers LATE — after the completions were already published, the async-setup gap — ' +
    'still receives every record published since its handle was obtained, in order', () => {
    // `useRepotAttempt()` is what captures the cursor, exactly as a renderer calls it at the top of setup,
    // BEFORE its own top-level awaits. Everything published after that line is this consumer's backlog.
    const handle = useRepotAttempt<{ v: number }, string>('done');

    const a = handle.begin('plant-A', { v: 1 });
    handle.resolveSuccess(a, 'A');
    const b = handle.begin('plant-B', { v: 2 });
    handle.resolveSuccess(b, 'B');

    // Only NOW does the consumer subscribe — the shape of a renderer registering after `await useAsyncData`.
    const seen = collector(handle);

    expect(seen.map((c) => c.plantId)).toEqual(['plant-A', 'plant-B']);
  });

  it('a consumer whose handle was obtained AFTER a completion never receives it — history predating a ' +
    'renderer is not replayed onto it on some unrelated later mount', () => {
    const earlier = useRepotAttempt<{ v: number }, string>('done');
    const a = earlier.begin('plant-A', { v: 1 });
    earlier.resolveSuccess(a, 'A');

    // A NEW renderer mounting later: its cursor starts at the log's current head.
    const later = useRepotAttempt<{ v: number }, string>('done');
    const seen = collector(later);

    expect(seen).toEqual([]);
  });

  it('no record is ever delivered twice to the same consumer, across the catch-up drain and the live watch', async () => {
    const handle = useRepotAttempt<{ v: number }, string>('done');
    const a = handle.begin('plant-A', { v: 1 });
    handle.resolveSuccess(a, 'A'); // published BEFORE subscribing -> arrives via the catch-up drain

    const seen = collector(handle);
    expect(seen).toHaveLength(1);

    const b = handle.begin('plant-B', { v: 2 });
    handle.resolveSuccess(b, 'B'); // published AFTER subscribing -> arrives via the live watch
    await nextTick();

    expect(seen.map((c) => c.plantId)).toEqual(['plant-A', 'plant-B']); // A exactly once, not twice
  });

  // R12-2 — a defect wave 11's own structural fix introduced, and the reason `drain` is a LOOP. The first
  // version drained once and THEN registered the watcher, so a record appended by a handler during that drain
  // landed while no watcher existed and was then taken as the new watcher's starting value — never delivered.
  it('a completion appended BY A HANDLER during the drain is still delivered — the drain re-checks instead of ' +
    'handing an un-watched append to a watcher that will treat it as its starting value', async () => {
    const handle = useRepotAttempt<{ v: number }, string>('done');
    const first = handle.begin('plant-A', { v: 1 });
    handle.resolveSuccess(first, 'A'); // published BEFORE subscribing -> arrives via the catch-up drain

    const seen: string[] = [];
    handle.subscribeCompletions((c) => {
      seen.push(c.plantId);
      if (c.plantId === 'plant-A') {
        // The handler itself completes a second attempt, synchronously, mid-drain.
        const second = handle.begin('plant-B', { v: 2 });
        handle.resolveSuccess(second, 'B');
      }
    });
    await nextTick();

    expect(seen).toEqual(['plant-A', 'plant-B']);
  });

  // R13-1 — a defect the R12-2 fix itself introduced: re-draining until the cursor reached the head chased a
  // MOVING head, so a handler appending on every invocation looped forever. Each drain now reads ONE snapshot,
  // so a pass is always finite and the handler's own append arrives on the NEXT watcher-scheduled pass.
  it('a handler that appends on EVERY invocation cannot hang the drain — each pass is bounded by the ' +
    'snapshot it started from', async () => {
    const handle = useRepotAttempt<{ v: number }, string>('done');
    const first = handle.begin('plant-0', { v: 0 });
    handle.resolveSuccess(first, 'r0');

    let n = 0;
    const seen: string[] = [];
    handle.subscribeCompletions((c) => {
      seen.push(c.plantId);
      n += 1;
      if (n < 3) { // each delivery appends again — a moving head the old loop would have chased
        const next = handle.begin(`plant-${n}`, { v: n });
        handle.resolveSuccess(next, `r${n}`);
      }
    });

    // THE ASSERTION IS THAT THIS LINE IS REACHED, and with ONE record handled: the pass was bounded by the
    // snapshot it started from and returned, rather than following the record its own handler had just added.
    expect(seen).toEqual(['plant-0']);

    // And bounded is not lossy — the appended records arrive on the watcher-scheduled passes that follow.
    await nextTick();
    await nextTick();
    expect(seen).toEqual(['plant-0', 'plant-1', 'plant-2']);
  });

  // R12-1 — the log is bounded, so a reader blocked in its own async setup while more than the cap lands has
  // provably missed records that no longer exist to be replayed. It must be TOLD, never silently skipped:
  // a silently dropped record is the exact class this whole design was built to delete.
  it('a subscriber whose cursor predates the oldest retained record gets an explicit GAP signal, not a ' +
    'silent skip', () => {
    const handle = useRepotAttempt<{ v: number }, string>('done'); // cursor captured here, at 0

    // More completions than the log retains, all while this reader has not yet subscribed.
    for (let i = 0; i < 55; i += 1) {
      const attempt = handle.begin(`plant-${i}`, { v: i });
      handle.resolveSuccess(attempt, `r${i}`);
    }

    const seen: string[] = [];
    let gaps = 0;
    handle.subscribeCompletions((c) => { seen.push(c.plantId); }, () => { gaps += 1; });

    expect(gaps).toBe(1);                    // told exactly once
    expect(seen).toHaveLength(50);           // and still handed everything the log DOES retain
    expect(seen[0]).toBe('plant-5');
  });

  it('a completion for a plant that is NOT live (already superseded by "start over") is never published — ' +
    'a stale success must not be mistaken for a completion by any consumer', () => {
    const handle = useRepotAttempt<{ v: number }, string>('done');
    const seen = collector(handle);
    const attempt = handle.begin('plant-1', { v: 1 });
    handle.invalidate('plant-1'); // the owner's explicit "start over" — attempt is no longer live

    handle.resolveSuccess(attempt, 'ignored'); // a late response for the now-abandoned attempt

    expect(seen).toEqual([]);
  });

  it('invalidate() (the "start over" escape hatch) itself never publishes a completion, even though it ' +
    'discards the attempt exactly like a success would', () => {
    const handle = useRepotAttempt<{ v: number }, string>('done');
    const seen = collector(handle);
    handle.begin('plant-1', { v: 1 });
    handle.invalidate('plant-1');

    expect(seen).toEqual([]);
  });

  it('each record carries a monotonically increasing `seq`, so a SECOND completion for the SAME plant is ' +
    'always its own distinguishable record, never conflated with the first', async () => {
    const handle = useRepotAttempt<{ v: number }, string>('done');
    const seen = collector(handle);

    const first = handle.begin('plant-1', { v: 1 });
    handle.resolveSuccess(first, 'first');

    const second = handle.begin('plant-1', { v: 2 }); // a wholly separate, later attempt for the same plant
    handle.resolveSuccess(second, 'second');
    await nextTick();

    expect(seen).toHaveLength(2);
    expect(seen[1]!.seq).toBeGreaterThan(seen[0]!.seq);
    expect(seen.map((c) => c.result)).toEqual(['first', 'second']);
  });

  it("does NOT share completions across DIFFERENT flow keys — 'evaluation' and 'done' stay two separate logs", () => {
    const evaluationHandle = useRepotAttempt<{ answer: string }, string>('evaluation');
    const doneHandle = useRepotAttempt<{ occurredOn: string }, string>('done');
    const seenByDone = collector(doneHandle);

    const attempt = evaluationHandle.begin('plant-1', { answer: 'no-signs' });
    evaluationHandle.resolveSuccess(attempt, 'REPOT');

    expect(seenByDone).toEqual([]);
  });

  it('__resetRepotAttemptStoresForTests clears the completion LOG too, not just the attempt map', async () => {
    const handle = useRepotAttempt<{ v: number }, string>('done');
    const seen = collector(handle);
    const attempt = handle.begin('plant-1', { v: 1 });
    handle.resolveSuccess(attempt, 'done');
    await nextTick();
    expect(seen).toHaveLength(1);

    __resetRepotAttemptStoresForTests();

    // A fresh handle for the same flow key reads a clean log, not the previous test's leftover.
    const freshHandle = useRepotAttempt<{ v: number }, string>('done');
    expect(collector(freshHandle)).toEqual([]);
  });
});
