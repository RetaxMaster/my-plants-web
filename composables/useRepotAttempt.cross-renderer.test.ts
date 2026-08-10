// @vitest-environment happy-dom
//
// X1: Wave 8 (W1) hoisted the two REPOT-attempt stores ('evaluation' / 'done') to MODULE scope, so an
// outstanding KEY survives a navigation between pages/index.vue (the Today page) and PlantDetail.vue (the
// plant-detail route). But the TERMINAL OUTCOME — what to do once the request finally succeeds — stayed
// local to whichever component's own try/catch happened to run it. That is the remaining race this file
// pins: the two renderers are never mounted at the same time in the real app (separate routes), but a
// departed page's in-flight PROMISE keeps running after the owner navigates away.
//
// Reachable scenario: the owner confirms a Done (or an evaluation submit) on the Today page, then navigates
// to the plant's detail page before the request settles. The detail page sees the shared outstanding key
// (W1) and opens its own modal/form frozen, resuming it. The Today request then succeeds: before this fix,
// ITS OWN handler closed ITS OWN (now-unmounted) modal and refreshed ONLY the Today list — the detail page's
// `doneAttempt`/`evaluationAttempt` computed went null (the shared map entry is gone), so its still-open
// modal/form silently UNFROZE while its own care/history/profile were never refreshed. Confirming again from
// that stale, unfrozen UI minted a FRESH idempotency key and the server recorded the SAME repot a SECOND
// time — the owner never having chosen "start over".
//
// This file mounts BOTH renderers SIMULTANEOUSLY (never done in the real app, where navigation unmounts the
// first) as the most direct way to prove the module-scope completion signal (useRepotAttempt.ts's
// `resolveSuccess`) reaches a SECOND, independently-mounted renderer instance for the SAME flow key — the
// exact property W1's own test file already pins for the attempt MAP, applied here to the completion SIGNAL.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { computed, inject, ref, shallowRef, watch } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import type { RepotEvaluationResult } from '../types/api.js';
import { __resetRepotAttemptStoresForTests, useRepotAttempt } from './useRepotAttempt';

vi.stubGlobal('ref', ref);
vi.stubGlobal('computed', computed);
vi.stubGlobal('shallowRef', shallowRef);
vi.stubGlobal('watch', watch);
vi.stubGlobal('inject', inject);
vi.stubGlobal('useI18n', () => ({ t: (k: string) => k, d: () => '', locale: ref('en') }));
vi.stubGlobal('useIsDesktop', () => ref(true));
vi.stubGlobal('useHead', () => {});
vi.stubGlobal('useSeoMeta', () => {});
vi.stubGlobal('navigateTo', vi.fn());
vi.stubGlobal('useTaskMeta', () => ({ dueLabel: () => 'Today', dueLabelLong: () => 'Today', healthLabel: () => '' }));
vi.stubGlobal('useFeedbackReasons', () => ({
  earlyWaterOptions: computed(() => []),
  postponeOptions: computed(() => []),
}));
vi.stubGlobal('useProfileMeta', () => ({
  windowDistanceLabel: () => null,
  potTypeLabel: () => null,
  soilMixLabel: () => null,
  growthHabitLabel: () => null,
}));
vi.stubGlobal('useRoute', () => ({ path: '/plants/p1' }));

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}

const PLANT = {
  id: 'p1', ownerId: 'o1', placeId: 'pl1', speciesSlug: 'ficus-lyrata', nickname: 'Gus',
  acquiredOn: '2026-01-01', speciesScientificName: 'Ficus lyrata', speciesCommonNameEs: null,
  speciesCommonNameEn: null, coverImageUrl: null, speciesGrowthHabit: null,
  lifecycleState: 'ACTIVE', frozenPlaceLabel: null, frozenCityLabel: null,
  latestProgress: null,
  profile: { potSizeCm: 20, soilMix: 'potting-mix' },
};

const CARE = {
  plantId: 'p1',
  tasks: [{ task: 'REPOT', status: 'today', daysUntilDue: 0, pendingEvaluation: null }],
};

const TASKS = [
  { plantId: 'p1', task: 'REPOT' as const, nextDueOn: '2026-01-01', pendingEvaluation: null },
];

let getPlantMock: ReturnType<typeof vi.fn>;
let getPlantCareMock: ReturnType<typeof vi.fn>;
let getPlantHistoryMock: ReturnType<typeof vi.fn>;
let completeRepotMock: ReturnType<typeof vi.fn>;
let completeRepotDeferred: ReturnType<typeof deferred<{ ok: true }>>;
let submitRepotEvaluationMock: ReturnType<typeof vi.fn>;
let submitRepotEvaluationDeferred: ReturnType<typeof deferred<RepotEvaluationResult>>;

beforeEach(() => {
  __resetRepotAttemptStoresForTests();
  completeRepotDeferred = deferred<{ ok: true }>();
  submitRepotEvaluationDeferred = deferred<RepotEvaluationResult>();
  getPlantMock = vi.fn(async () => PLANT);
  getPlantCareMock = vi.fn(async () => CARE);
  getPlantHistoryMock = vi.fn(async () => []);
  completeRepotMock = vi.fn(async () => completeRepotDeferred.promise);
  submitRepotEvaluationMock = vi.fn(async () => submitRepotEvaluationDeferred.promise);

  vi.stubGlobal('useApi', () => ({
    todaysTasks: async () => TASKS,
    listPlants: async () => [],
    listPlaces: async () => [],
    getRepotSigns: async () => ({ signs: [] }),
    getSoilReadings: async () => ({ instruments: [], protocol: null, readings: [] }),
    // Plan 3 T5: pages/index.vue now fetches the owner's selected instruments unconditionally on every
    // mount (to gate a WATER row's survey affordance) — this file's Today mount needs the same stub every
    // other pages/index.test.ts scenario already carries, or the fetch throws synchronously.
    getOwnerInstruments: async () => ({ available: [], selected: [] }),
    getPlant: getPlantMock,
    getPlantCare: getPlantCareMock,
    getPlantHistory: getPlantHistoryMock,
    getPlantPhotos: async () => [],
    invalidatePlant: vi.fn(),
    completeRepot: completeRepotMock,
    submitRepotEvaluation: submitRepotEvaluationMock,
  }));
  // Generic: `refresh()` re-runs the SAME fetcher `fn`, so a later assertion on the underlying api mock's
  // call count (getPlantMock/getPlantCareMock/getPlantHistoryMock) is what proves "refreshed its own data" —
  // never an assertion on the refresh() wrapper itself, which would prove nothing about what actually re-ran.
  vi.stubGlobal('useAsyncData', async (_key: string, fn: () => Promise<unknown>) => {
    const data = ref(await fn());
    return { data, refresh: vi.fn(async () => { data.value = await fn(); }) };
  });
  vi.stubGlobal('useLazyAsyncData', (_key: string, fn: () => Promise<unknown>) => {
    const data = ref<unknown>(null);
    const refresh = vi.fn(async () => { data.value = await fn(); });
    void refresh();
    return { data, refresh };
  });
});

// Minimal, STATELESS stubs — this file's only concern is the completion SIGNAL reaching a second renderer,
// not the modal/form's own internal hydration (RepotDoneForm.test.ts / RepotEvaluationModal.test.ts /
// pages/index.test.ts's own W3 block cover that).
const todayStubs = {
  UiCard: { template: '<div><slot name="header" /><slot /></div>' },
  UiCardGrid: { template: '<div><slot /></div>' },
  UiEmptyState: { template: '<div><slot /></div>' },
  UiScreenHeader: true,
  UiAlert: { props: ['color', 'description', 'announce'], template: '<div class="repot-error-banner"><slot /></div>' },
  UiButton: { props: ['size', 'variant', 'color'], emits: ['click'], template: '<button class="retry-btn" @click="$emit(\'click\')"><slot /></button>' },
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
    // Plan 3 T5: pages/index.vue now routes `@evaluate` on the emitted `{ task }` payload (REPOT vs a
    // WATER survey) — mirrors the real TaskRow.vue's own `emit('evaluate', { task: props.task })`, same fix
    // pages/index.test.ts's own UiTaskRow stub carries. Every task here is REPOT, so this is
    // behaviour-preserving for this file's own scenarios.
    emits: ['evaluate', 'done'],
    template:
      '<div><button class="evaluate-btn" @click="$emit(\'evaluate\', { task })">evaluate</button>' +
      '<button class="done-btn" @click="$emit(\'done\', { task: \'REPOT\' })">done</button></div>',
  },
  UiSoilReadingModal: {
    props: ['open', 'plantId', 'data', 'mode'],
    emits: ['update:open', 'saved'],
    template: '<div class="soil-modal" :data-open="open" :data-mode="mode" />',
  },
  UiRepotEvaluationModal: {
    props: ['open', 'signs', 'submitting', 'error', 'frozen'],
    emits: ['submit', 'start-over'],
    template:
      '<div class="eval-modal" :data-open="open" :data-frozen="frozen" :data-submitting="submitting">' +
      '<button class="submit-btn" @click="$emit(\'submit\', { answer: \'no-signs\' })">submit</button></div>',
  },
  UiRepotDoneForm: {
    props: ['open', 'currentPotSizeCm', 'currentSoilMix', 'submitting', 'error', 'frozen'],
    emits: ['confirm', 'start-over', 'update:open'],
    template:
      '<div class="done-form" :data-open="open" :data-frozen="frozen" :data-submitting="submitting">' +
      '<button class="confirm-btn" @click="$emit(\'confirm\', { potSizeCm: currentPotSizeCm, soilMix: currentSoilMix, charged: true })">confirm</button></div>',
  },
  NuxtLink: { template: '<a><slot /></a>' },
};

const detailStubs = {
  UiScreenHeader: true,
  UiAlert: true,
  UiPlantPhoto: true,
  UiPhotoChip: true,
  UiCard: { template: '<div><slot /></div>' },
  UiPlantName: true,
  UiAppIcon: true,
  UiViabilityBadge: true,
  UiBadge: true,
  UiSectionTitle: true,
  UiEmptyState: true,
  UiMeter: true,
  UiInfoItem: true,
  UiTaskRow: {
    props: ['task'],
    emits: ['evaluate', 'done'],
    // Task 6 (watering-survey-web plan): PlantDetail.vue's `@evaluate` handler now branches on `e.task`
    // (WATER routes to the survey, everything else — REPOT here — still routes to `onEvaluate`), same fix
    // as pages/index.vue's own stub above.
    template:
      '<div><button class="evaluate-btn" @click="$emit(\'evaluate\', { task: \'REPOT\' })">evaluate</button>' +
      '<button class="done-btn" @click="$emit(\'done\', { task: \'REPOT\' })">done</button></div>',
  },
  HistoryTimeline: true,
  UiImageDropzone: true,
  UiAutosizeTextarea: true,
  UiReasonPicker: true,
  UiTaskInfoModal: true,
  UiImageLightbox: true,
  PlantEditModal: true,
  ProgressEntryModal: true,
  ClinicalRecordModal: true,
  NoteModal: true,
  PlantProfileModal: true,
  UiRepotVerdictModal: {
    props: ['open', 'result'],
    template: '<div class="verdict-modal" :data-open="open" :data-verdict="result && result.verdict" />',
  },
  UiRepotEvaluationModal: {
    props: ['open', 'signs', 'submitting', 'error', 'frozen'],
    emits: ['submit', 'start-over'],
    template:
      '<div class="eval-modal" :data-open="open" :data-frozen="frozen" :data-submitting="submitting">' +
      '<button class="submit-btn" @click="$emit(\'submit\', { answer: \'no-signs\' })">submit</button></div>',
  },
  UiRepotDoneForm: {
    props: ['open', 'currentPotSizeCm', 'currentSoilMix', 'submitting', 'error', 'frozen'],
    emits: ['confirm', 'start-over'],
    template:
      '<div class="done-form" :data-open="open" :data-frozen="frozen" :data-submitting="submitting">' +
      '<button class="confirm-btn" @click="$emit(\'confirm\', { potSizeCm: currentPotSizeCm, soilMix: currentSoilMix, charged: true })">confirm</button></div>',
  },
  UiButton: { props: ['disabled', 'loading', 'color', 'variant', 'icon', 'block', 'size', 'to'], emits: ['click'], template: '<button @click="$emit(\'click\')"><slot /></button>' },
  UiModal: true,
  UiConfirmModal: true,
  UiFormGroup: true,
  UiSelectField: true,
  UiSoilReadingModal: true,
};

async function mountToday() {
  const TodayPage = (await import('../pages/index.vue')).default;
  const w = mount(
    { components: { TodayPage }, template: '<Suspense><TodayPage /></Suspense>' },
    { global: { stubs: todayStubs, mocks: { $t: (k: string) => k } } },
  );
  await flushPromises();
  return w;
}

async function mountDetail() {
  const PlantDetail = (await import('../components/PlantDetail.vue')).default;
  const w = mount(
    { components: { PlantDetail }, template: '<Suspense><PlantDetail id="p1" /></Suspense>' },
    { global: { stubs: detailStubs, mocks: { $t: (k: string) => k, $d: (v: unknown) => String(v) } } },
  );
  await flushPromises();
  return w;
}

describe('X1 — cross-renderer: a Done confirmed on Today, resolved only after the owner navigated to the ' +
  'plant detail page, closes the DETAIL page\'s form and refreshes ITS OWN data', () => {
  it('detail resumes the shared frozen form, then the completion signal closes it, refreshes detail\'s own ' +
    'care/history/plant, and clears the attempt so the NEXT confirm mints a genuinely fresh key', async () => {
    const today = await mountToday();

    // Confirm a Done on Today: mints a key, the request is in flight (never resolved yet).
    await today.find('.done-btn').trigger('click');
    await flushPromises();
    await today.find('.confirm-btn').trigger('click');
    await flushPromises();
    expect(completeRepotMock).toHaveBeenCalledTimes(1);
    const firstKey = completeRepotMock.mock.calls[0]![3];
    expect(firstKey).toBeTruthy();

    // The owner navigates to the plant's detail page BEFORE the request settles — Today's promise keeps
    // running. Mount the detail renderer for the SAME plant while it is still pending.
    const detail = await mountDetail();
    const careReadsBeforeCompletion = getPlantCareMock.mock.calls.length;
    const historyReadsBeforeCompletion = getPlantHistoryMock.mock.calls.length;

    // The detail page's own "Done" click sees the shared outstanding key (W1) and resumes it FROZEN — never
    // a fresh fetch, never a fresh key.
    await detail.find('.done-btn').trigger('click');
    await flushPromises();
    expect(detail.find('.done-form').attributes('data-open')).toBe('true');
    expect(detail.find('.done-form').attributes('data-frozen')).toBe('true');

    // Today's original request now settles.
    completeRepotDeferred.resolve({ ok: true });
    await flushPromises();

    // X1: the completion signal reaches the DETAIL renderer even though it never made the request itself —
    // its own form closes (never left open-but-unfrozen, which is what let the old bug resubmit) and its own
    // care/history reads re-ran.
    expect(detail.find('.done-form').attributes('data-open')).toBe('false');
    expect(getPlantCareMock.mock.calls.length).toBeGreaterThan(careReadsBeforeCompletion);
    expect(getPlantHistoryMock.mock.calls.length).toBeGreaterThan(historyReadsBeforeCompletion);

    // The attempt is fully cleared — the NEXT confirm from the detail page is a genuinely FRESH attempt,
    // never a resubmission of the closed form's stale frozen body: a fresh open is unfrozen, and its confirm
    // mints a DIFFERENT key than the original.
    await detail.find('.done-btn').trigger('click');
    await flushPromises();
    expect(detail.find('.done-form').attributes('data-frozen')).toBe('false');
    await detail.find('.confirm-btn').trigger('click');
    await flushPromises();
    expect(completeRepotMock).toHaveBeenCalledTimes(2);
    const secondKey = completeRepotMock.mock.calls[1]![3];
    expect(secondKey).toBeTruthy();
    expect(secondKey).not.toBe(firstKey);
  });
});

describe('X1 — cross-renderer: the evaluation-flow sibling — a submit confirmed on Today, resolved only ' +
  'after the owner navigated to the plant detail page, closes the DETAIL page\'s modal, shows ITS OWN ' +
  'verdict, and refreshes ITS OWN data', () => {
  it('detail resumes the shared frozen evaluation, then the completion signal closes it, shows the ' +
    'verdict, and refreshes detail\'s own care/history', async () => {
    const today = await mountToday();

    await today.find('.evaluate-btn').trigger('click');
    await flushPromises();
    await today.find('.submit-btn').trigger('click');
    await flushPromises();
    expect(submitRepotEvaluationMock).toHaveBeenCalledTimes(1);

    const detail = await mountDetail();
    const careReadsBeforeCompletion = getPlantCareMock.mock.calls.length;
    const historyReadsBeforeCompletion = getPlantHistoryMock.mock.calls.length;

    await detail.find('.evaluate-btn').trigger('click');
    await flushPromises();
    expect(detail.find('.eval-modal').attributes('data-open')).toBe('true');
    expect(detail.find('.eval-modal').attributes('data-frozen')).toBe('true');

    submitRepotEvaluationDeferred.resolve({ evaluationId: 'ev-1', verdict: 'REPOT' });
    await flushPromises();

    expect(detail.find('.eval-modal').attributes('data-open')).toBe('false');
    expect(detail.find('.verdict-modal').attributes('data-open')).toBe('true');
    expect(detail.find('.verdict-modal').attributes('data-verdict')).toBe('REPOT');
    expect(getPlantCareMock.mock.calls.length).toBeGreaterThan(careReadsBeforeCompletion);
    expect(getPlantHistoryMock.mock.calls.length).toBeGreaterThan(historyReadsBeforeCompletion);
  });
});

// Z2: the two describe blocks above both mount BOTH renderers SIMULTANEOUSLY, which guarantees a subscriber
// (the detail page's completion watcher) already exists the instant `resolveSuccess()` runs — that can never
// reach the race Z2 closes. The real gap is narrower and lives entirely INSIDE one renderer's own async
// setup: PlantDetail awaits its own plant/care reads at the top of `setup()` and registers its completion
// watchers only AFTERWARDS. A completion published DURING that window — a departed Today page's leftover
// promise settling while PlantDetail is still fetching its OWN data — used to be silently lost: `watch()`
// only fires on a FUTURE change to the ref, never on whatever is already sitting in `.value` the moment it
// registers, so PlantDetail would take the already-current (already-handled-by-nobody) completion as its
// baseline and never react to it — closing nothing, refreshing nothing, and leaving its own Done attempt
// gone with a stale, unfrozen form none the wiser.
//
// This test reaches that gap directly, WITHOUT ever mounting Today (or any other subscriber) at all — the
// whole point is that the completion is published while genuinely nobody is listening yet, which "mount
// both renderers together" can never reproduce. It never extends the describe blocks above; it is its own
// case, per the ruling's own instruction.
describe('Z2 — the completion signal must not be LOSSY across PlantDetail\'s own async route-setup gap', () => {
  it('a completion published WHILE PlantDetail is still awaiting its own care read — strictly before its ' +
    'completion watcher has registered — is still caught: its own care/history reconcile still runs, never ' +
    'silently missed just because no subscriber existed at the moment it was published', async () => {
    // Hold PlantDetail's OWN care read open so its setup is provably still mid-flight (past the baseline
    // capture, which happens before even the FIRST await, but before the watcher registration, which happens
    // only after this SECOND await resolves) when the stale completion below is published.
    const careDeferred = deferred<typeof CARE>();
    getPlantCareMock.mockImplementationOnce(async () => careDeferred.promise);

    // Deliberately NOT awaited yet: PlantDetail's setup runs through its plant read and blocks on care.
    const detailPromise = mountDetail();
    await flushPromises();

    // The stale Done mutation "commits" now — published through the SAME 'done' flow store PlantDetail
    // itself reads, exactly as a departed Today page's leftover promise handler would on a real navigation,
    // but WITHOUT ever mounting Today (or anything else) as a subscriber. `useRepotAttempt('done')` resolves
    // to the identical module-scope store PlantDetail's own call resolves to (W1) — this is a second,
    // independently-obtained handle onto it, exactly the shape a genuinely separate page component would use.
    const staleDoneHandle =
      useRepotAttempt<{ occurredOn: string; payload: { potSizeCm: number; soilMix: string } }>('done');
    const staleAttempt = staleDoneHandle.begin('p1', {
      occurredOn: '2026-01-01',
      payload: { potSizeCm: 22, soilMix: 'cactus-mix' },
    });
    staleDoneHandle.resolveSuccess(staleAttempt);

    // ONLY NOW does PlantDetail's own care read resolve, letting its setup continue past the gap — the
    // completion above was published strictly BEFORE this point, i.e. strictly before PlantDetail's own
    // completion watcher has had any chance to register.
    careDeferred.resolve(CARE);
    await flushPromises();
    await detailPromise;

    // Before the Z2 fix: the watcher registers AFTER the completion already published, takes the
    // already-current value as its own baseline, and never fires for it — care/history are never refreshed
    // beyond their one initial fetch. After the fix: the setup-continuation catch-up (comparing the
    // completion's `seq` against the baseline captured before the awaits) sees it as unprocessed and handles
    // it BEFORE the watcher takes over, so both reads re-run a second time.
    expect(getPlantCareMock.mock.calls.length).toBeGreaterThan(1);
    expect(getPlantHistoryMock.mock.calls.length).toBeGreaterThan(1);
  });
});

// R11-1: the composable-level test in useRepotAttempt.test.ts already proves the LOG itself retains both
// records of a two-plant burst. This is the renderer-level sibling — the actual PlantDetail component,
// pinned to ONE plant for its whole lifetime, must still notice ITS OWN completion when it lands in the same
// burst as a DIFFERENT plant's, not just whichever one happens to be last. Two attempts are begun directly
// through the shared module-scope 'done' store (the same store a Today confirm on each of two different
// plants would leave outstanding), never via mounting Today — the only thing this test needs from the burst
// is that both plants have a live attempt when they resolve.
describe('R11-1 — cross-renderer: a burst of two same-flow completions must not let the SECOND plant\'s ' +
  'completion overwrite the FIRST plant\'s for a live renderer', () => {
  it('detail page\'s own-plant completion, resolved FIRST in a two-plant back-to-back burst, still closes ' +
    'its form and reconciles its own care/history — never silently swallowed by the OTHER plant\'s ' +
    'completion landing right after', async () => {
    const handle =
      useRepotAttempt<{ occurredOn: string; payload: { potSizeCm: number; soilMix: string } }>('done');
    const ownAttempt = handle.begin('p1', { occurredOn: '2026-01-01', payload: { potSizeCm: 22, soilMix: 'cactus-mix' } });
    const otherAttempt = handle.begin('p2', { occurredOn: '2026-01-01', payload: { potSizeCm: 18, soilMix: 'potting-mix' } });

    const detail = await mountDetail();

    // The detail page's own "Done" click sees the shared outstanding key for ITS OWN plant (p1) and resumes
    // it frozen — same resume proof the first describe block above already pins.
    await detail.find('.done-btn').trigger('click');
    await flushPromises();
    expect(detail.find('.done-form').attributes('data-open')).toBe('true');
    expect(detail.find('.done-form').attributes('data-frozen')).toBe('true');

    const careReadsBeforeCompletion = getPlantCareMock.mock.calls.length;
    const historyReadsBeforeCompletion = getPlantHistoryMock.mock.calls.length;

    // Both attempts resolve from the SAME network tick: their continuations run in two consecutive
    // microtasks, strictly less time than a Vue watcher flush — the exact shape the composable-level test
    // measures the bug with. The detail page's OWN plant (p1) resolves FIRST and the other plant (p2)
    // resolves SECOND: under the old single-latest-value ref this is exactly the ordering that makes p1's
    // record the one overwritten before any watcher ever observes it.
    await Promise.all([
      Promise.resolve().then(() => { handle.resolveSuccess(ownAttempt); }),
      Promise.resolve().then(() => { handle.resolveSuccess(otherAttempt); }),
    ]);
    await flushPromises();

    // The detail page's own form still closes and its own care/history reconcile — the own-plant completion
    // was NOT swallowed by the other plant's completion landing in the same burst.
    expect(detail.find('.done-form').attributes('data-open')).toBe('false');
    expect(getPlantCareMock.mock.calls.length).toBeGreaterThan(careReadsBeforeCompletion);
    expect(getPlantHistoryMock.mock.calls.length).toBeGreaterThan(historyReadsBeforeCompletion);

    // The attempt is genuinely cleared, not just visually unfrozen while still open: reopening is a FRESH,
    // unfrozen form, and confirming it mints a key different from the one the original (now-completed)
    // attempt held — never a resubmission of a repot the server already recorded.
    await detail.find('.done-btn').trigger('click');
    await flushPromises();
    expect(detail.find('.done-form').attributes('data-frozen')).toBe('false');
    await detail.find('.confirm-btn').trigger('click');
    await flushPromises();
    expect(completeRepotMock).toHaveBeenCalledTimes(1);
    const key = completeRepotMock.mock.calls[0]![3];
    expect(key).toBeTruthy();
    expect(key).not.toBe(ownAttempt.key);
  });
});
