// @vitest-environment happy-dom
//
// Round-3/adversarial finding Y1: pages/index.vue's REPOT evaluation modal is ONE instance shared by every
// plant card on the Today page. Submitting for plant A, then abandoning that attempt (switching to plant
// B) WITHOUT the in-flight request being cancelled, then A's response finally arriving, must never clobber
// B's now-active attempt — no closing B's still-open modal, no discarding B's outstanding idempotency key,
// no showing A's verdict as if it belonged to B. This file pins the fix directly against `onEvaluationSubmit`
// (there is no other test file for pages/index.vue at all — same gap TaskRow.test.ts's header documents).
//
// `ref`/`computed` are Vue's own reactivity primitives, normally auto-imported by Nuxt's build pipeline —
// outside it (plain vitest + @vue/test-utils, no auto-import shim) they don't exist as globals, same
// technique PlantDetail.test.ts / pages/plants/index.test.ts use.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { computed, ref } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import type { RepotEvaluationResult, RepotSign } from '../types/api.js';

vi.stubGlobal('ref', ref);
vi.stubGlobal('computed', computed);
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

// A controllable, externally-resolvable promise — lets the test hold a plant's submit "in flight" and
// settle it at a chosen moment, independent of any other plant's own in-flight submit.
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}

const TASKS = [
  { plantId: 'A', task: 'REPOT' as const, nextDueOn: '2026-01-01', pendingEvaluation: null },
  { plantId: 'B', task: 'REPOT' as const, nextDueOn: '2026-01-01', pendingEvaluation: null },
];

let getRepotSignsMock: ReturnType<typeof vi.fn>;
let submitDeferreds: Record<string, ReturnType<typeof deferred<RepotEvaluationResult>>>;
let submitRepotEvaluationMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  submitDeferreds = { A: deferred<RepotEvaluationResult>(), B: deferred<RepotEvaluationResult>() };
  getRepotSignsMock = vi.fn(async () => ({ signs: [] as RepotSign[] }));
  submitRepotEvaluationMock = vi.fn(async (plantId: string) => submitDeferreds[plantId].promise);

  vi.stubGlobal('useApi', () => ({
    todaysTasks: async () => TASKS,
    listPlants: async () => [],
    listPlaces: async () => [],
    getRepotSigns: getRepotSignsMock,
    submitRepotEvaluation: submitRepotEvaluationMock,
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
  UiAlert: true,
  UiButton: true, // only rendered inside the (unreached in this test) evaluationLoadFailed retry slot
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
    emits: ['evaluate'],
    template: '<button class="evaluate-btn" @click="$emit(\'evaluate\')">evaluate</button>',
  },
  UiRepotEvaluationModal: {
    props: ['open', 'signs', 'submitting', 'error', 'frozen'],
    emits: ['submit', 'start-over'],
    template:
      '<div class="eval-modal" :data-open="open" :data-frozen="frozen" :data-submitting="submitting">' +
      '<button class="submit-btn" @click="$emit(\'submit\', { answer: \'no-signs\' })">submit</button>' +
      '</div>',
  },
  UiRepotDoneForm: true,
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
