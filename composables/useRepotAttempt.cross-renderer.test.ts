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
import { __resetRepotAttemptStoresForTests } from './useRepotAttempt';

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
    emits: ['evaluate', 'done'],
    template:
      '<div><button class="evaluate-btn" @click="$emit(\'evaluate\')">evaluate</button>' +
      '<button class="done-btn" @click="$emit(\'done\', { task: \'REPOT\' })">done</button></div>',
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
    template:
      '<div><button class="evaluate-btn" @click="$emit(\'evaluate\')">evaluate</button>' +
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
