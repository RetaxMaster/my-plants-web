// W1: `useRepotAttempt(flowKey)` used to create a BRAND-NEW Map every time it was CALLED, so
// `pages/index.vue` and `PlantDetail.vue` — two separate call sites for the identical 'evaluation'/'done'
// flows — each got their OWN, component-lifetime-scoped store. The fix hoists the store to MODULE scope,
// one per flow key, so every caller asking for the SAME flow key shares the SAME Map. These tests exercise
// the composable directly (no Vue component involved) to pin that guarantee at its source, independent of
// which renderer (Today page or plant detail) happens to be asking.
import { describe, it, expect, beforeEach } from 'vitest';
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
