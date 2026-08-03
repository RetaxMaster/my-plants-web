// @vitest-environment happy-dom
//
// Round-3/adversarial finding Y1: pages/index.vue's REPOT evaluation modal is ONE instance shared by every
// plant card on the Today page. Submitting for plant A, then abandoning that attempt (switching to plant
// B) WITHOUT the in-flight request being cancelled, then A's response finally arriving, must never clobber
// B's now-active attempt — no closing B's still-open modal, no discarding B's outstanding idempotency key,
// no showing A's verdict as if it belonged to B. This file pins the fix directly against `onEvaluationSubmit`
// (there is no other test file for pages/index.vue at all — same gap TaskRow.test.ts's header documents).
//
// `onRepotDoneConfirm` shares the exact same shape (its own Done form is likewise ONE instance shared by
// every plant card) and carried the identical defect — ruled as an in-scope fix in the SAME review pass
// (leaving one guarded and its sibling unguarded, in the same file, right next to each other, is exactly
// the parallel-copy bug class this project names as its highest-yield). The second describe block below
// pins that fix the same way.
//
// `ref`/`computed` are Vue's own reactivity primitives, normally auto-imported by Nuxt's build pipeline —
// outside it (plain vitest + @vue/test-utils, no auto-import shim) they don't exist as globals, same
// technique PlantDetail.test.ts / pages/plants/index.test.ts use.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { computed, ref, shallowRef } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import type { RepotEvaluationResult, RepotSign } from '../types/api.js';

vi.stubGlobal('ref', ref);
vi.stubGlobal('computed', computed);
vi.stubGlobal('shallowRef', shallowRef);
vi.stubGlobal('useI18n', () => ({ t: (k: string) => k, d: () => '', locale: ref('en') }));
vi.stubGlobal('useIsDesktop', () => ref(true));
vi.stubGlobal('useHead', () => {});
vi.stubGlobal('useSeoMeta', () => {});
vi.stubGlobal('navigateTo', vi.fn());
vi.stubGlobal('useTaskMeta', () => ({ dueLabel: () => 'Today' }));
vi.stubGlobal('useFeedbackReasons', () => ({
  earlyWaterOptions: computed(() => []),
  postponeOptions: computed(() => []),
}));

// A controllable, externally-resolvable/rejectable promise — lets the test hold a plant's submit "in
// flight" and settle it (success OR failure — round-4 finding V2 needs the latter, to prove a rejection
// reaches the same recovery state a timeout depends on) at a chosen moment, independent of any other
// plant's own in-flight submit.
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const TASKS = [
  { plantId: 'A', task: 'REPOT' as const, nextDueOn: '2026-01-01', pendingEvaluation: null },
  { plantId: 'B', task: 'REPOT' as const, nextDueOn: '2026-01-01', pendingEvaluation: null },
];

const PLANT_PROFILES: Record<string, { potSizeCm: number; soilMix: string }> = {
  A: { potSizeCm: 20, soilMix: 'potting-mix' },
  B: { potSizeCm: 25, soilMix: 'cactus-mix' },
};

let getRepotSignsMock: ReturnType<typeof vi.fn>;
let submitDeferreds: Record<string, ReturnType<typeof deferred<RepotEvaluationResult>>>;
let submitRepotEvaluationMock: ReturnType<typeof vi.fn>;
let getPlantMock: ReturnType<typeof vi.fn>;
let completeRepotDeferreds: Record<string, ReturnType<typeof deferred<{ ok: true }>>>;
let completeRepotMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  submitDeferreds = { A: deferred<RepotEvaluationResult>(), B: deferred<RepotEvaluationResult>() };
  completeRepotDeferreds = { A: deferred<{ ok: true }>(), B: deferred<{ ok: true }>() };
  getRepotSignsMock = vi.fn(async () => ({ signs: [] as RepotSign[] }));
  submitRepotEvaluationMock = vi.fn(async (plantId: string) => submitDeferreds[plantId].promise);
  getPlantMock = vi.fn(async (plantId: string) => ({ profile: PLANT_PROFILES[plantId] }));
  completeRepotMock = vi.fn(async (plantId: string) => completeRepotDeferreds[plantId].promise);

  vi.stubGlobal('useApi', () => ({
    todaysTasks: async () => TASKS,
    listPlants: async () => [],
    listPlaces: async () => [],
    getRepotSigns: getRepotSignsMock,
    submitRepotEvaluation: submitRepotEvaluationMock,
    getPlant: getPlantMock,
    completeRepot: completeRepotMock,
  }));
  vi.stubGlobal('useAsyncData', async (_key: string, fn: () => Promise<unknown>) => ({
    data: ref(await fn()),
    refresh: vi.fn(async () => {}),
  }));
  vi.stubGlobal('useLazyAsyncData', (_key: string, fn: () => Promise<unknown>) => {
    const data = ref<unknown>(null);
    void Promise.resolve(fn()).then((v) => { data.value = v; });
    return { data, refresh: vi.fn(async () => {}) };
  });
});

// The stubs below stand in for the real UiTaskRow/UiRepotEvaluationModal (both already covered by their
// own test files) — this file's only concern is pages/index.vue's OWN event wiring. Each stubbed TaskRow
// exposes one button per plant card that fires the SAME `evaluate` event the real component emits; the
// stubbed modal exposes the props this test asserts against (`open`, `frozen`, `submitting`) as data
// attributes, plus a submit button that emits a fixed, distinguishable body per plant.
const stubs = {
  UiCard: { template: '<div><slot name="header" /><slot /></div>' },
  UiCardGrid: { template: '<div><slot /></div>' },
  UiEmptyState: { template: '<div><slot /></div>' },
  UiScreenHeader: true,
  // B3: the retry button now lives INSIDE this banner's default slot (mirrors onEvaluate's pre-existing
  // load-failure retry) — a real stub that renders its slot, not `true`, so the tests below can reach it.
  UiAlert: {
    props: ['color', 'description', 'announce'],
    template: '<div class="repot-error-banner"><slot /></div>',
  },
  // B3: the retry button inside the load-failure banner is now reachable (a failed `onRepotDone` getPlant
  // fetch surfaces it too, not just a failed `onEvaluate` signs fetch) — a real clickable stub, not `true`,
  // so the retry tests below can drive it.
  UiButton: {
    props: ['size', 'variant', 'color'],
    emits: ['click'],
    template: '<button class="retry-btn" @click="$emit(\'click\', $event)"><slot /></button>',
  },
  UiPlantPhoto: true,
  UiPlantAvatar: true,
  UiPlantName: true,
  UiPhotoChip: true,
  UiAppIcon: true,
  UiReasonPicker: true,
  UiRepotVerdictModal: {
    props: ['open', 'result'],
    template: '<div class="verdict-modal" :data-open="open" :data-verdict="result && result.verdict" />',
  },
  UiTaskRow: {
    props: ['task'],
    emits: ['evaluate', 'done'],
    template:
      '<div>' +
      '<button class="evaluate-btn" @click="$emit(\'evaluate\')">evaluate</button>' +
      '<button class="done-btn" @click="$emit(\'done\', { task: \'REPOT\' })">done</button>' +
      '</div>',
  },
  UiRepotEvaluationModal: {
    props: ['open', 'signs', 'submitting', 'error', 'frozen'],
    emits: ['submit', 'start-over'],
    template:
      '<div class="eval-modal" :data-open="open" :data-frozen="frozen" :data-submitting="submitting">' +
      '<button class="submit-btn" @click="$emit(\'submit\', { answer: \'no-signs\' })">submit</button>' +
      '</div>',
  },
  UiRepotDoneForm: {
    props: ['open', 'currentPotSizeCm', 'currentSoilMix', 'submitting', 'error', 'frozen'],
    emits: ['confirm', 'start-over', 'update:open'],
    template:
      '<div class="done-form" :data-open="open" :data-frozen="frozen" :data-submitting="submitting">' +
      '<button class="confirm-btn" @click="$emit(\'confirm\', { potSizeCm: currentPotSizeCm, soilMix: currentSoilMix, charged: true })">confirm</button>' +
      // B1: a close button that drives the REAL v-model:open contract (X/Escape/backdrop in the real
      // component), never an internal function — this is how the resume tests below simulate the owner
      // dismissing the form without resolving an outstanding confirm.
      '<button class="close-btn" @click="$emit(\'update:open\', false)">close</button>' +
      '</div>',
  },
  NuxtLink: { template: '<a><slot /></a>' },
};

async function mountPage() {
  const TodayPage = (await import('./index.vue')).default;
  const w = mount(
    { components: { TodayPage }, template: '<Suspense><TodayPage /></Suspense>' },
    { global: { stubs, mocks: { $t: (k: string) => k } } },
  );
  await flushPromises();
  return w;
}

describe('pages/index.vue — a late response from an ABANDONED evaluation submit (Y1)', () => {
  it('never clobbers the now-active plant\'s outstanding key, open modal, or verdict', async () => {
    const w = await mountPage();
    const evaluateButtons = w.findAll('.evaluate-btn');
    expect(evaluateButtons).toHaveLength(2); // one card per plant — A first, B second

    // Open + submit for plant A: mints a key, the request is now in flight (never resolved yet).
    await evaluateButtons[0]!.trigger('click');
    await flushPromises();
    await w.find('.submit-btn').trigger('click');
    await flushPromises();
    expect(submitRepotEvaluationMock).toHaveBeenCalledTimes(1);
    expect(submitRepotEvaluationMock.mock.calls[0]![0]).toBe('A');

    // Abandon A without cancelling its request: switch to plant B's card. This is a DIFFERENT plant, so
    // onEvaluate resets the key (not a resume) and opens a fresh questionnaire for B.
    await evaluateButtons[1]!.trigger('click');
    await flushPromises();
    expect(w.find('.eval-modal').attributes('data-open')).toBe('true');
    expect(w.find('.eval-modal').attributes('data-frozen')).toBe('false'); // fresh attempt, not frozen yet

    // Submit for B: mints its OWN key, its own in-flight request.
    await w.find('.submit-btn').trigger('click');
    await flushPromises();
    expect(submitRepotEvaluationMock).toHaveBeenCalledTimes(2);
    expect(submitRepotEvaluationMock.mock.calls[1]![0]).toBe('B');
    expect(w.find('.eval-modal').attributes('data-submitting')).toBe('true');

    // A's LATE response now arrives — resolved only now, after B has fully taken over the shared modal.
    submitDeferreds.A!.resolve({ evaluationId: 'ev-A', verdict: 'REPOT' });
    await flushPromises();

    // The abandoned A response must be ignored entirely: B's modal stays open, B's submit is still
    // (from this test's perspective) in flight, and NO verdict was shown for A's response.
    expect(w.find('.eval-modal').attributes('data-open')).toBe('true');
    expect(w.find('.eval-modal').attributes('data-submitting')).toBe('true');
    expect(w.find('.verdict-modal').attributes('data-open')).toBe('false');

    // B's own response now arrives — THIS is the active attempt, and it drives the shared UI as normal.
    submitDeferreds.B!.resolve({ evaluationId: 'ev-B', verdict: 'RE-EVALUATE', reevaluateOn: '2026-02-01' });
    await flushPromises();

    expect(w.find('.eval-modal').attributes('data-open')).toBe('false');
    expect(w.find('.eval-modal').attributes('data-submitting')).toBe('false');
    expect(w.find('.verdict-modal').attributes('data-open')).toBe('true');
    expect(w.find('.verdict-modal').attributes('data-verdict')).toBe('RE-EVALUATE');
  });
});

describe('pages/index.vue — round-4 finding V1: the submitting flag must never get stuck (failure 1)', () => {
  it('onEvaluationSubmit: opening a DIFFERENT plant while a submit is still in flight must not leave the ' +
    'new modal stuck "submitting" forever', async () => {
    const w = await mountPage();
    const evaluateButtons = w.findAll('.evaluate-btn');

    // Start a submit for A and leave it in flight — never resolved.
    await evaluateButtons[0]!.trigger('click');
    await flushPromises();
    await w.find('.submit-btn').trigger('click');
    await flushPromises();
    expect(w.find('.eval-modal').attributes('data-submitting')).toBe('true');

    // Abandon A WITHOUT submitting or resolving it: just open B's card. B has submitted nothing yet, so its
    // freshly-opened modal must read submitting=false — the bug left it stuck `true` forever because A's
    // own `finally` never runs (its plant/key pair never matches again once evaluationPlantId moved on).
    await evaluateButtons[1]!.trigger('click');
    await flushPromises();

    expect(w.find('.eval-modal').attributes('data-open')).toBe('true');
    expect(w.find('.eval-modal').attributes('data-submitting')).toBe('false');
  });

  it('onRepotDoneConfirm: opening a DIFFERENT plant\'s Done form while a confirm is still in flight must ' +
    'not leave the new form stuck "submitting" forever', async () => {
    const w = await mountPage();
    const doneButtons = w.findAll('.done-btn');

    // Start a confirm for A and leave it in flight — never resolved.
    await doneButtons[0]!.trigger('click');
    await flushPromises();
    await w.find('.confirm-btn').trigger('click');
    await flushPromises();
    expect(w.find('.done-form').attributes('data-submitting')).toBe('true');

    // Abandon A WITHOUT confirming or resolving it: just open B's Done form.
    await doneButtons[1]!.trigger('click');
    await flushPromises();

    expect(w.find('.done-form').attributes('data-open')).toBe('true');
    expect(w.find('.done-form').attributes('data-submitting')).toBe('false');
  });
});

describe('pages/index.vue — round-4 finding V1: the submitting flag must never get stuck (failure 2)', () => {
  it('onEvaluationSubmit: a stale success must not clear a NEWER attempt\'s submitting flag when its own ' +
    'refresh() resolves late', async () => {
    // A controllable `refresh()` lets the test hold A's success mid-flight (past the point where it has
    // already closed its own modal) so a newer attempt (B) can start DURING that window — exactly the gap
    // where the old code's `finally` clobbered B's flag once A's refresh() finally resolved.
    const refreshDeferred = deferred<void>();
    vi.stubGlobal('useAsyncData', async (_key: string, fn: () => Promise<unknown>) => ({
      data: ref(await fn()),
      refresh: vi.fn(() => refreshDeferred.promise),
    }));

    const w = await mountPage();
    const evaluateButtons = w.findAll('.evaluate-btn');

    // Submit A; it succeeds, but its refresh() is held open.
    await evaluateButtons[0]!.trigger('click');
    await flushPromises();
    await w.find('.submit-btn').trigger('click');
    await flushPromises();
    submitDeferreds.A!.resolve({ evaluationId: 'ev-A', verdict: 'REPOT' });
    await flushPromises();
    // A's own modal already closed and its own attempt was already cleared — refresh() is what's still
    // pending.
    expect(w.find('.eval-modal').attributes('data-open')).toBe('false');

    // While A's refresh() is still pending, the owner opens B and submits.
    await evaluateButtons[1]!.trigger('click');
    await flushPromises();
    await w.find('.submit-btn').trigger('click');
    await flushPromises();
    expect(w.find('.eval-modal').attributes('data-submitting')).toBe('true');

    // A's refresh() now finally resolves — its own bookkeeping must NOT touch B's now-active submitting.
    refreshDeferred.resolve();
    await flushPromises();

    expect(w.find('.eval-modal').attributes('data-submitting')).toBe('true');
  });

  it('onRepotDoneConfirm: a stale success must not clear a NEWER attempt\'s submitting flag when its own ' +
    'refresh() resolves late', async () => {
    const refreshDeferred = deferred<void>();
    vi.stubGlobal('useAsyncData', async (_key: string, fn: () => Promise<unknown>) => ({
      data: ref(await fn()),
      refresh: vi.fn(() => refreshDeferred.promise),
    }));

    const w = await mountPage();
    const doneButtons = w.findAll('.done-btn');

    // Confirm A; it succeeds, but its refresh() is held open.
    await doneButtons[0]!.trigger('click');
    await flushPromises();
    await w.find('.confirm-btn').trigger('click');
    await flushPromises();
    completeRepotDeferreds.A!.resolve({ ok: true });
    await flushPromises();
    expect(w.find('.done-form').attributes('data-open')).toBe('false');

    // While A's refresh() is still pending, the owner opens B's Done form and confirms.
    await doneButtons[1]!.trigger('click');
    await flushPromises();
    await w.find('.confirm-btn').trigger('click');
    await flushPromises();
    expect(w.find('.done-form').attributes('data-submitting')).toBe('true');

    // A's refresh() now finally resolves — its own bookkeeping must NOT touch B's now-active submitting.
    refreshDeferred.resolve();
    await flushPromises();

    expect(w.find('.done-form').attributes('data-submitting')).toBe('true');
  });
});

describe('pages/index.vue — round-4 finding V2: a failed submit (including a request useApi.ts now times ' +
  'out instead of letting hang forever) must leave a way out', () => {
  it('onEvaluationSubmit: a rejection clears submitting, keeps the key (frozen stays true), surfaces the ' +
    'error, and leaves the modal open — never a dead end', async () => {
    const w = await mountPage();
    await w.findAll('.evaluate-btn')[0]!.trigger('click');
    await flushPromises();
    await w.find('.submit-btn').trigger('click');
    await flushPromises();
    expect(w.find('.eval-modal').attributes('data-submitting')).toBe('true');

    // A hung connection that useApi.ts's new `timeout` option (REPOT_SUBMIT_TIMEOUT_MS) eventually aborts
    // rejects exactly like this — the recovery this fix depends on is that ANY rejection here (not just a
    // 4xx/5xx) reaches the same "frozen && error" state RepotEvaluationModal.vue gates "start over" on.
    submitDeferreds.A!.reject(Object.assign(new Error('[TimeoutError]: aborted due to timeout'), { statusCode: undefined }));
    await flushPromises();

    expect(w.find('.eval-modal').attributes('data-submitting')).toBe('false');
    expect(w.find('.eval-modal').attributes('data-frozen')).toBe('true'); // key kept — a retry reuses it
    expect(w.find('.eval-modal').attributes('data-open')).toBe('true'); // never force-closed — no dead end
  });

  it('onRepotDoneConfirm: a rejection clears submitting, keeps the key (frozen stays true), surfaces the ' +
    'error, and leaves the form open — never a dead end', async () => {
    const w = await mountPage();
    await w.findAll('.done-btn')[0]!.trigger('click');
    await flushPromises();
    await w.find('.confirm-btn').trigger('click');
    await flushPromises();
    expect(w.find('.done-form').attributes('data-submitting')).toBe('true');

    completeRepotDeferreds.A!.reject(Object.assign(new Error('[TimeoutError]: aborted due to timeout'), { statusCode: undefined }));
    await flushPromises();

    expect(w.find('.done-form').attributes('data-submitting')).toBe('false');
    expect(w.find('.done-form').attributes('data-frozen')).toBe('true');
    expect(w.find('.done-form').attributes('data-open')).toBe('true');
  });
});

describe('pages/index.vue — a late response from an ABANDONED Done-form confirm (Y1\'s sibling, ruled ' +
  'in the same pass)', () => {
  it('never clobbers the now-active plant\'s outstanding doneKey or open Done form', async () => {
    const w = await mountPage();
    const doneButtons = w.findAll('.done-btn');
    expect(doneButtons).toHaveLength(2); // one card per plant — A first, B second

    // Open + confirm for plant A: mints a doneKey, the request is now in flight (never resolved yet).
    await doneButtons[0]!.trigger('click');
    await flushPromises();
    expect(getPlantMock).toHaveBeenCalledWith('A');
    await w.find('.confirm-btn').trigger('click');
    await flushPromises();
    expect(completeRepotMock).toHaveBeenCalledTimes(1);
    expect(completeRepotMock.mock.calls[0]![0]).toBe('A');
    const keyA = completeRepotMock.mock.calls[0]![3];
    expect(keyA).toBeTruthy();

    // Abandon A without cancelling its request: switch to plant B's card. onRepotDone unconditionally
    // resets doneKey for the newly-opened plant, so B starts a genuinely fresh attempt.
    await doneButtons[1]!.trigger('click');
    await flushPromises();
    expect(getPlantMock).toHaveBeenCalledWith('B');
    expect(w.find('.done-form').attributes('data-open')).toBe('true');
    expect(w.find('.done-form').attributes('data-frozen')).toBe('false'); // fresh attempt, not frozen yet

    // Confirm for B: mints its OWN doneKey, its own in-flight request.
    await w.find('.confirm-btn').trigger('click');
    await flushPromises();
    expect(completeRepotMock).toHaveBeenCalledTimes(2);
    expect(completeRepotMock.mock.calls[1]![0]).toBe('B');
    const keyB = completeRepotMock.mock.calls[1]![3];
    expect(keyB).toBeTruthy();
    expect(keyB).not.toBe(keyA); // two genuinely separate confirmations must never share a key
    expect(w.find('.done-form').attributes('data-submitting')).toBe('true');

    // A's LATE response now arrives — resolved only now, after B has fully taken over the shared form.
    completeRepotDeferreds.A!.resolve({ ok: true });
    await flushPromises();

    // The abandoned A response must be ignored entirely: B's form stays open and B's confirm is still
    // (from this test's perspective) in flight.
    expect(w.find('.done-form').attributes('data-open')).toBe('true');
    expect(w.find('.done-form').attributes('data-submitting')).toBe('true');

    // B's own response now arrives — THIS is the active attempt, and it closes the shared form as normal.
    completeRepotDeferreds.B!.resolve({ ok: true });
    await flushPromises();

    expect(w.find('.done-form').attributes('data-open')).toBe('false');
    expect(w.find('.done-form').attributes('data-submitting')).toBe('false');
  });
});

// B1: `onRepotDone` used to call `invalidateDoneAttempt()` unconditionally before opening the form, on the
// false premise that "the Done form has no resume path" — but RepotDoneForm.vue's own `watch(open, ...)`
// guard skips the field reset while `frozen`, specifically to support a resume after the owner closes the
// form (X/Escape/backdrop) without resolving an outstanding confirm. Because the parent always cleared the
// attempt first, that guard could never fire: a lost Done-confirm response kept the key and froze the
// form, the owner dismissed it, and the next open discarded the key and re-prefilled — so the next confirm
// minted a FRESH idempotency key and the server recorded a SECOND, non-deduplicated completion of a repot
// it already recorded. This is finding V12's unfixed twin (V12 was fixed for the evaluation modal earlier
// in this same review).
describe('pages/index.vue — B1: the Done form must resume its outstanding attempt across close and reopen', () => {
  it('a failed confirm keeps the key; closing the form via its own update:open contract and reopening ' +
    'resumes it — the retry sends the SAME idempotency key, and the form is still frozen', async () => {
    const w = await mountPage();
    const doneButtons = w.findAll('.done-btn');

    // Open + confirm for A: the confirm fails, so the key is retained and the form freezes.
    await doneButtons[0]!.trigger('click');
    await flushPromises();
    expect(getPlantMock).toHaveBeenCalledTimes(1);
    await w.find('.confirm-btn').trigger('click');
    await flushPromises();
    completeRepotDeferreds.A!.reject(new Error('lost response'));
    await flushPromises();

    expect(completeRepotMock).toHaveBeenCalledTimes(1);
    const keyFirst = completeRepotMock.mock.calls[0]![3];
    expect(keyFirst).toBeTruthy();
    expect(w.find('.done-form').attributes('data-frozen')).toBe('true');

    // The owner closes the form via the component's own update:open / v-model:open contract (X/Escape/
    // backdrop in the real component) — NOT by calling an internal function — without resolving the
    // outstanding confirm.
    await w.find('.close-btn').trigger('click');
    await flushPromises();
    expect(w.find('.done-form').attributes('data-open')).toBe('false');

    // Reopen via the Done button: this must RESUME, not reset — same plant, key still outstanding for it.
    // No re-fetch of the profile prefill either (the frozen body must stay byte-identical to what the key
    // was minted for).
    await doneButtons[0]!.trigger('click');
    await flushPromises();
    expect(getPlantMock).toHaveBeenCalledTimes(1); // still just the one call from the original open
    expect(w.find('.done-form').attributes('data-open')).toBe('true');
    expect(w.find('.done-form').attributes('data-frozen')).toBe('true'); // still frozen — resumed, not reset

    // The retry (the same confirm button) must send the SAME key.
    await w.find('.confirm-btn').trigger('click');
    await flushPromises();
    expect(completeRepotMock).toHaveBeenCalledTimes(2);
    const keySecond = completeRepotMock.mock.calls[1]![3];
    expect(keySecond).toBe(keyFirst);
    expect(w.find('.done-form').attributes('data-frozen')).toBe('true');
  });

  it('a different plant still mints a fresh key and re-prefills — the resume guard is per-plant, not global', async () => {
    const w = await mountPage();
    const doneButtons = w.findAll('.done-btn');

    // A fails and freezes with an outstanding key.
    await doneButtons[0]!.trigger('click');
    await flushPromises();
    await w.find('.confirm-btn').trigger('click');
    await flushPromises();
    completeRepotDeferreds.A!.reject(new Error('lost response'));
    await flushPromises();
    const keyA = completeRepotMock.mock.calls[0]![3];
    expect(w.find('.done-form').attributes('data-frozen')).toBe('true');

    // Opening B's Done form is a DIFFERENT plant: a fresh attempt, not a resume — re-fetches B's profile
    // and is not frozen.
    await doneButtons[1]!.trigger('click');
    await flushPromises();
    expect(getPlantMock).toHaveBeenCalledWith('B');
    expect(w.find('.done-form').attributes('data-frozen')).toBe('false');

    await w.find('.confirm-btn').trigger('click');
    await flushPromises();
    const keyB = completeRepotMock.mock.calls[1]![3];
    expect(keyB).not.toBe(keyA);
  });

  it('a successful confirm leaves no outstanding key — reopening the SAME plant afterwards is a fresh ' +
    'attempt (re-fetches the profile, mints a new key), not a resume', async () => {
    const w = await mountPage();
    const doneButtons = w.findAll('.done-btn');

    await doneButtons[0]!.trigger('click');
    await flushPromises();
    await w.find('.confirm-btn').trigger('click');
    await flushPromises();
    completeRepotDeferreds.A!.resolve({ ok: true });
    await flushPromises();
    const keyFirst = completeRepotMock.mock.calls[0]![3];
    expect(w.find('.done-form').attributes('data-open')).toBe('false');

    getPlantMock.mockClear();
    await doneButtons[0]!.trigger('click');
    await flushPromises();
    expect(getPlantMock).toHaveBeenCalledWith('A'); // re-fetched — nothing to resume
    expect(w.find('.done-form').attributes('data-frozen')).toBe('false');

    await w.find('.confirm-btn').trigger('click');
    await flushPromises();
    const keySecond = completeRepotMock.mock.calls[1]![3];
    expect(keySecond).not.toBe(keyFirst);
  });
});

// B3: `onRepotDone`'s `api.getPlant(plantId)` call had NO try/catch, and the function is invoked from a
// template event handler whose returned promise nobody awaits — so a 5xx/timeout produced an unhandled
// rejection, the form never opened, `repotError` stayed false, and the Done button simply looked dead: no
// error, no retry, no explanation. The fix reuses the SAME mechanism `onEvaluate`'s own load-failure banner
// already uses (finding W16) via the shared `evaluationLoadFailed`/`repotRetry` state, never a second
// banner or a second flag with its own template branch.
describe('pages/index.vue — B3: a failed getPlant fetch must not leave the Done button looking dead', () => {
  it('leaves the form CLOSED, surfaces the load-failure banner\'s retry, and the retry re-runs onRepotDone ' +
    'successfully on the second call', async () => {
    getPlantMock.mockRejectedValueOnce(new Error('network error'));
    const w = await mountPage();
    const doneButtons = w.findAll('.done-btn');

    await doneButtons[0]!.trigger('click');
    await flushPromises();

    // The form never opens — no dead end, the failure is surfaced instead.
    expect(w.find('.done-form').attributes('data-open')).toBe('false');
    expect(w.find('.retry-btn').exists()).toBe(true);

    // The banner's retry re-runs the SAME failed loader (onRepotDone for the SAME plant) — this time the
    // (now-default, non-rejecting) getPlant mock succeeds.
    await w.find('.retry-btn').trigger('click');
    await flushPromises();

    expect(getPlantMock).toHaveBeenCalledTimes(2);
    expect(w.find('.done-form').attributes('data-open')).toBe('true');
    expect(w.find('.retry-btn').exists()).toBe(false); // banner cleared once the retry succeeds
  });

  it('a stale-target click during the failed fetch is not surfaced against the wrong plant (race guard F4)', async () => {
    getPlantMock.mockRejectedValueOnce(new Error('network error'));
    const w = await mountPage();
    const doneButtons = w.findAll('.done-btn');

    await doneButtons[0]!.trigger('click'); // A's getPlant is now in flight (rejects on the next microtask)
    // Before it settles, the owner opens B's Done form instead — a genuinely fresh, successful fetch.
    await doneButtons[1]!.trigger('click');
    await flushPromises();

    // B's own open must not be clobbered by A's now-stale rejection.
    expect(w.find('.done-form').attributes('data-open')).toBe('true');
  });
});
