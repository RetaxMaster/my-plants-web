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
import { computed, inject, ref, shallowRef, watch } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import type { PlantSoilReadings, RepotEvaluationResult, RepotSign } from '../types/api.js';
// X2: the parent-level integration test near the end of this file mounts the REAL RepotDoneForm.vue (never a
// re-implemented stub of its hydration watcher — see that describe block's own header comment for why).
import RealRepotDoneForm from '../components/ui/RepotDoneForm.vue';
// W1 moved the two REPOT-attempt stores (`'evaluation'` / `'done'`) to MODULE scope, so — unlike the
// per-component-instance Maps this file's tests used to exercise — they now persist across every `it()` in
// THIS file (the module is imported once and cached for the whole file). Without an explicit reset, an
// attempt minted by an earlier test (e.g. plant A's outstanding Done key from the B1 describe block) is
// still sitting in the store when a LATER, unrelated test mounts a fresh page and opens plant A's card again
// — read as a "resume" it never asked for. Every test in this file uses plant ids 'A'/'B', so this collision
// is not hypothetical; it reproduces on a plain sequential run.
import { __resetRepotAttemptStoresForTests, useRepotAttempt } from '../composables/useRepotAttempt';

vi.stubGlobal('ref', ref);
vi.stubGlobal('computed', computed);
vi.stubGlobal('shallowRef', shallowRef);
// `watch` (X1: pages/index.vue now watches the shared completion signal) and `inject` (X2: the parent-level
// integration test below mounts the REAL RepotDoneForm.vue, whose real Input.vue/SelectField.vue call
// `inject('mpFieldId', ...)`) — same technique as the `ref`/`computed`/`shallowRef` stubs above.
vi.stubGlobal('watch', watch);
vi.stubGlobal('inject', inject);
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
// X2: only needed by the parent-level integration test below, which mounts the REAL RepotDoneForm.vue (it
// calls this composable for its soil-mix options) — both plant fixtures' soil mixes must resolve to a real
// <option>, or the native <select>'s displayed value would silently blank instead of reflecting the model.
vi.stubGlobal('useProfileMeta', () => ({
  soilMixOptions: computed(() => [
    { value: 'potting-mix', label: 'Potting mix' },
    { value: 'cactus-mix', label: 'Cactus mix' },
  ]),
  // The REAL implementation, copied rather than faked: RepotDoneForm builds its mix options through it, and
  // a stub returning a different SHAPE (e.g. without the prepended empty "I don't know" option) would make
  // the form under test structurally different from the shipped one. Three lines, no dependencies. See
  // composables/useProfileMeta.ts.
  withNotSet: (opts: { value: string; label: string }[], notSetLabel?: string | null) =>
    [{ value: '', label: notSetLabel ?? 'plantProfile.pickOption' }, ...opts],
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
// Plan 3 T5: the WATER survey's own two api calls. Defaulted to "the owner selected nothing" / "an empty
// per-plant reading catalogue" so every PRE-EXISTING (REPOT-focused) test in this file — which never touches
// either — keeps passing unmodified; the WATER-specific describe block below overrides them per test.
let getOwnerInstrumentsMock: ReturnType<typeof vi.fn>;
let getSoilReadingsMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  // Store-isolation (W1): reset BOTH module-scope attempt stores before every test so no test's outstanding
  // key/body/error survives into the next one.
  __resetRepotAttemptStoresForTests();
  submitDeferreds = { A: deferred<RepotEvaluationResult>(), B: deferred<RepotEvaluationResult>() };
  completeRepotDeferreds = { A: deferred<{ ok: true }>(), B: deferred<{ ok: true }>() };
  getRepotSignsMock = vi.fn(async () => ({ signs: [] as RepotSign[] }));
  submitRepotEvaluationMock = vi.fn(async (plantId: string) => submitDeferreds[plantId].promise);
  getPlantMock = vi.fn(async (plantId: string) => ({ profile: PLANT_PROFILES[plantId] }));
  completeRepotMock = vi.fn(async (plantId: string) => completeRepotDeferreds[plantId].promise);
  getOwnerInstrumentsMock = vi.fn(async () => ({ available: [], selected: [] as string[] }));
  getSoilReadingsMock = vi.fn(async () => (
    { instruments: [], protocol: null, readings: [], wateringDays: [] } as unknown as PlantSoilReadings
  ));

  vi.stubGlobal('useApi', () => ({
    todaysTasks: async () => TASKS,
    listPlants: async () => [],
    listPlaces: async () => [],
    getRepotSigns: getRepotSignsMock,
    submitRepotEvaluation: submitRepotEvaluationMock,
    getPlant: getPlantMock,
    completeRepot: completeRepotMock,
    getOwnerInstruments: getOwnerInstrumentsMock,
    getSoilReadings: getSoilReadingsMock,
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
    // `checkedSignIds` (2026-08-07): the ids the owner ticked, which the real modal subtracts from the
    // catalogue to name a corroborating sign. Exposed here so this file can pin that THIS renderer wires
    // it — the same line exists in PlantDetail.vue, and a half-wired renderer is exactly the drift these
    // two files keep producing.
    props: ['open', 'result', 'signs', 'checkedSignIds'],
    template:
      '<div class="verdict-modal" :data-open="open" :data-verdict="result && result.verdict" ' +
      ':data-checked="checkedSignIds && checkedSignIds.join(\',\')" :data-signs="signs && signs.length" />',
  },
  UiTaskRow: {
    // OBJECT prop declaration for `allowStandaloneDone`/`canSurvey`, not the array shorthand: only a prop
    // DECLARED Boolean gets Vue's bare-attribute casting, so the array form would read `''` (falsy) even
    // from a caller that DID pass it — a stub that could never fail the "Done must not leak onto Today"
    // test, nor Plan 3 T5's WATER canSurvey wiring tests below.
    props: {
      task: null,
      allowStandaloneDone: { type: Boolean, default: false },
      canSurvey: { type: Boolean, default: false },
    },
    // Plan 3 T5: `evaluate` now carries a payload ({ task }), mirroring the REAL TaskRow.vue's own
    // `emit('evaluate', { task: props.task })` — pages/index.vue routes on it to tell a REPOT evaluate from
    // a WATER survey, reusing the ONE event rather than adding a parallel one. Every pre-existing REPOT test
    // below still passes: their stubbed click already resolves to `task: 'REPOT'` off the real `:task`
    // binding, which routes to the unchanged `onEvaluate` branch.
    emits: ['evaluate', 'done', 'postpone'],
    template:
      '<div :data-allow-standalone-done="String(!!allowStandaloneDone)" :data-can-survey="String(!!canSurvey)">' +
      // Mirrors TaskRow.vue's OWN `showEvaluate` gate for WATER (`canSurvey === true`) — never re-derives
      // REPOT's gate (that stays ungated here, exactly as before this row existed; REPOT's own state
      // machine is TaskRow.vue's job and is covered by TaskRow.test.ts, not this wiring-level file).
      '<button v-if="task !== \'WATER\' || canSurvey" class="evaluate-btn" @click="$emit(\'evaluate\', { task })">evaluate</button>' +
      '<template v-if="task !== \'WATER\' || !canSurvey">' +
      '<button class="done-btn" @click="$emit(\'done\', { task })">done</button>' +
      '<button class="postpone-btn" @click="$emit(\'postpone\', { task })">postpone</button>' +
      '</template>' +
      '</div>',
  },
  // Plan 3 T5: stands in for the real SoilReadingModal.vue (covered by its own test file) — this file's only
  // concern is that pages/index.vue opens it for the right plant, in the right MODE, and reconciles Today
  // through the SAME `refresh()` seam every other completion already uses (see `onReadingSaved` below and
  // the mutation-proof tests in the WATER describe block).
  UiSoilReadingModal: {
    props: ['open', 'plantId', 'data', 'mode'],
    emits: ['update:open', 'saved'],
    template:
      '<div class="soil-modal" :data-open="open" :data-mode="mode" :data-plant-id="plantId">' +
      '<button class="soil-save-btn" @click="$emit(\'saved\')">save</button>' +
      '</div>',
  },
  UiRepotEvaluationModal: {
    props: ['open', 'signs', 'submitting', 'error', 'frozen', 'typicalIntervalMonths'],
    emits: ['submit', 'start-over'],
    template:
      // `data-error` (W2): exposes the modal's OWN `error` prop, the surface that would show a cross-plant
      // (or cross-flow) error leak — mirrors the identical `data-error` hook already on UiRepotDoneForm below.
      // `data-sign-ids` (FIX D3): the catalogue the questionnaire is rendering, by ID — the ONE surface on
      // which a catalogue belonging to a DIFFERENT plant would be visible.
      '<div class="eval-modal" :data-open="open" :data-frozen="frozen" :data-submitting="submitting" :data-error="error" ' +
      ':data-sign-ids="(signs || []).map(s => s.id).join(\',\')" '+
      // `data-typical` (B1 of the 2026-08-07 review): the OTHER value that travels in the same
      // plant-keyed catalogue record, and the one whose plant check used to be restated inline.
      ':data-typical="typicalIntervalMonths == null ? \'none\' : String(typicalIntervalMonths)">' +
      '<button class="submit-btn" @click="$emit(\'submit\', { answer: \'no-signs\' })">submit</button>' +
      // 2026-08-07: a CHECKED-SIGNS body, so this file can pin that the ticked ids reach the verdict modal
      // (they are what it subtracts from the catalogue to name a corroborating sign).
      '<button class="submit-signs-btn" @click="$emit(\'submit\', { answer: \'signs\', signIds: [\'s1\'] })">submit signs</button>' +
      '</div>',
  },
  UiRepotDoneForm: {
    props: ['open', 'currentPotSizeCm', 'currentSoilMix', 'submitting', 'error', 'frozen'],
    emits: ['confirm', 'start-over', 'update:open'],
    template:
      // `data-error` (U3): exposes the form's OWN `error` prop — the ONE surface that would show a
      // cross-plant error leak, since the page-level banner is hidden entirely while this form is open
      // (`v-if="repotError && !evaluationOpen && !doneFormOpen"`) and so cannot catch that leak on its own.
      '<div class="done-form" :data-open="open" :data-frozen="frozen" :data-submitting="submitting" :data-error="error">' +
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

  // U1 REPLACES a test that used to live here and BLESSED the single-slot defect: it opened plant A, failed
  // it (freezing it with an outstanding key), then opened plant B and asserted B was unfrozen with a
  // DIFFERENT key — true, but incomplete, because the single slot meant opening B SILENTLY DISCARDED A's
  // only replay key, with the owner never having chosen "start over". The reachable consequence: A's Done
  // completion may have already committed on the server before its response was lost; discarding its key
  // let a later retry on A mint a FRESH key, and the server would record a SECOND, non-deduplicated repot
  // completion. A test asserting a defect is worse than no test — this one proves the opposite property
  // instead: A's key survives the detour through B, and the retry replays the exact byte-for-byte original
  // request.
  it("plant A's outstanding key survives opening plant B's form and returning to A; the retry resends A's " +
    'ORIGINAL key and body (U1 — the per-plant attempt map)', async () => {
    const w = await mountPage();
    const doneButtons = w.findAll('.done-btn');

    // A confirms. Its response is LOST — indistinguishable, client-side, from any other rejection, from a
    // case where the server-side commit actually SUCCEEDED and only the reply never arrived — so the key
    // is kept and the form freezes.
    await doneButtons[0]!.trigger('click');
    await flushPromises();
    await w.find('.confirm-btn').trigger('click');
    await flushPromises();
    completeRepotDeferreds.A!.reject(new Error('lost response'));
    await flushPromises();
    expect(completeRepotMock).toHaveBeenCalledTimes(1);
    const firstCall = completeRepotMock.mock.calls[0]!;
    const [keyAPlantId, keyAOccurredOn, keyAPayload, keyA] = firstCall;
    expect(keyA).toBeTruthy();
    expect(w.find('.done-form').attributes('data-frozen')).toBe('true');

    // The owner does NOT choose "start over" — they simply open plant B's Done form instead. Before U1,
    // this UNCONDITIONALLY discarded A's only replay key via the single shared slot.
    await doneButtons[1]!.trigger('click');
    await flushPromises();
    expect(getPlantMock).toHaveBeenCalledWith('B');
    expect(w.find('.done-form').attributes('data-frozen')).toBe('false'); // B is a genuinely fresh attempt

    // Returning to A's card must RESUME — no re-fetch of A's profile, still frozen, same key — never a
    // fresh attempt that would mint a NEW key and let the server record a second completion.
    await doneButtons[0]!.trigger('click');
    await flushPromises();
    expect(getPlantMock).toHaveBeenCalledTimes(2); // the original A open + the one B open — NOT a third for A
    expect(w.find('.done-form').attributes('data-frozen')).toBe('true');

    // The retry sends the byte-for-byte ORIGINAL request: same plantId, same occurredOn, same payload, same
    // key — asserted on the ACTUAL mock arguments, never on an internal ref.
    await w.find('.confirm-btn').trigger('click');
    await flushPromises();
    expect(completeRepotMock).toHaveBeenCalledTimes(2);
    const secondCall = completeRepotMock.mock.calls[1]!;
    expect(secondCall[0]).toBe(keyAPlantId);
    expect(secondCall[1]).toBe(keyAOccurredOn);
    expect(secondCall[2]).toEqual(keyAPayload);
    expect(secondCall[3]).toBe(keyA);
  });

  // The same shape exists on the evaluation flow (its own useRepotAttempt instance, same per-plant map).
  it("plant A's outstanding evaluation key survives opening plant B's evaluation modal and returning to A; " +
    "the retry resends A's ORIGINAL key and body (U1)", async () => {
    const w = await mountPage();
    const evaluateButtons = w.findAll('.evaluate-btn');

    await evaluateButtons[0]!.trigger('click');
    await flushPromises();
    await w.find('.submit-btn').trigger('click');
    await flushPromises();
    submitDeferreds.A!.reject(new Error('lost response'));
    await flushPromises();
    expect(submitRepotEvaluationMock).toHaveBeenCalledTimes(1);
    const [keyAPlantId, keyABody, keyA] = submitRepotEvaluationMock.mock.calls[0]!;
    expect(keyA).toBeTruthy();
    expect(w.find('.eval-modal').attributes('data-frozen')).toBe('true');

    // Open B's evaluation instead of retrying A — no "start over" was chosen.
    await evaluateButtons[1]!.trigger('click');
    await flushPromises();
    expect(w.find('.eval-modal').attributes('data-frozen')).toBe('false');

    // Returning to A must resume: still frozen, same key.
    await evaluateButtons[0]!.trigger('click');
    await flushPromises();
    expect(w.find('.eval-modal').attributes('data-frozen')).toBe('true');

    await w.find('.submit-btn').trigger('click');
    await flushPromises();
    expect(submitRepotEvaluationMock).toHaveBeenCalledTimes(2);
    const secondCall = submitRepotEvaluationMock.mock.calls[1]!;
    expect(secondCall[0]).toBe(keyAPlantId);
    expect(secondCall[1]).toEqual(keyABody);
    expect(secondCall[2]).toBe(keyA);
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

  // FIX D1, the TWIN SWEEP. PlantDetail.vue's `onRepotDone` gated its resume early-return on the weaker
  // "is a key outstanding?" instead of the predicate `begin()` itself uses, and after a 400 that silently
  // discarded a corrected back-date. Today has no back-date input (its `occurredOn` is a module-level
  // constant), so THAT symptom is unreachable here — but the same weak predicate was live on this file too,
  // and these two renderers have drifted on this flow repeatedly. This pins the predicate itself on Today,
  // through the one difference it can express here: a 400 committed nothing, so reopening is a genuinely
  // FRESH attempt (re-reads the prefill, mints a new key) rather than a resume of a key the server has
  // already rejected — which, resumed, would 422 forever the moment the owner corrected the value.
  it('after a 400, reopening the Done form is a FRESH attempt — the prefill is re-fetched and the next ' +
    'confirm mints a new key, never a resume of the rejected one', async () => {
    const w = await mountPage();
    const doneButtons = w.findAll('.done-btn');

    await doneButtons[0]!.trigger('click');
    await flushPromises();
    expect(getPlantMock).toHaveBeenCalledTimes(1);
    await w.find('.confirm-btn').trigger('click');
    await flushPromises();
    // A 400 is what an over-max / decimal pot size actually produces (see `classifyRepotFailure`).
    completeRepotDeferreds.A!.reject(Object.assign(new Error('pot size out of range'), { statusCode: 400 }));
    await flushPromises();

    const keyFirst = completeRepotMock.mock.calls[0]![3];
    // The 400 unfreezes the fields — the owner is being invited to correct the value (FIX C).
    expect(w.find('.done-form').attributes('data-frozen')).toBe('false');

    await w.find('.close-btn').trigger('click');
    await flushPromises();
    getPlantMock.mockClear();
    await doneButtons[0]!.trigger('click');
    await flushPromises();
    expect(getPlantMock).toHaveBeenCalledWith('A'); // re-read: there is nothing to stay byte-identical to
    expect(w.find('.done-form').attributes('data-frozen')).toBe('false');

    await w.find('.confirm-btn').trigger('click');
    await flushPromises();
    expect(completeRepotMock).toHaveBeenCalledTimes(2);
    expect(completeRepotMock.mock.calls[1]![3]).not.toBe(keyFirst);
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

  // U3: this test used to drive A's getPlant() with `mockRejectedValueOnce`, an ALREADY-rejected promise,
  // then await sequentially — so by the time B's click even fired, A's rejection had already been handled
  // (or not) with no way for the test to observe which. The assertion ("B's form is open") was true whether
  // or not the F4 race guard existed at all, since a same-tick microtask ordering settles A before B's own
  // open ever runs its check. A DEFERRED promise instead holds A's fetch open on purpose, so B's card can be
  // clicked while A is GENUINELY still in flight, and A is rejected deterministically only afterwards — the
  // guard is what stops that now-provably-late rejection from touching B's already-open form.
  it('a stale-target click during the failed fetch is not surfaced against the wrong plant (race guard F4)', async () => {
    const deferredA = deferred<{ profile: { potSizeCm: number; soilMix: string } }>();
    getPlantMock.mockImplementationOnce(() => deferredA.promise);
    const w = await mountPage();
    const doneButtons = w.findAll('.done-btn');

    await doneButtons[0]!.trigger('click'); // A's getPlant is now GENUINELY in flight — held open, not settled.
    await flushPromises();
    expect(w.find('.done-form').attributes('data-open')).toBe('false'); // still loading, not open yet

    // Before A's fetch settles, the owner opens B's Done form instead — a genuinely fresh, successful fetch.
    await doneButtons[1]!.trigger('click');
    await flushPromises();
    expect(w.find('.done-form').attributes('data-open')).toBe('true'); // B's own open succeeded
    expect(w.find('.done-form').attributes('data-frozen')).toBe('false');

    // A's held fetch NOW rejects, deterministically, well after B has already taken over the shared target.
    deferredA.reject(new Error('network error'));
    await flushPromises();

    // The stale rejection must never touch B's already-open form: still open, no retry affordance, and —
    // the one surface the page-level banner's `!doneFormOpen` gate can't cover, since B's form IS open — no
    // error surfaced INSIDE B's own form either. Without the guard, A's rejection sets the shared `repotError`
    // flag unconditionally, which B's still-open form would render as its OWN error, even though B never failed.
    expect(w.find('.done-form').attributes('data-open')).toBe('true');
    expect(w.find('.repot-error-banner').exists()).toBe(false);
    expect(w.find('.retry-btn').exists()).toBe(false);
    expect(w.find('.done-form').attributes('data-error')).toBeFalsy();
  });
});

// U2: freezing the VISIBLE form fields is not enough — `evaluationId` is read fresh off the live Today
// task list at confirm time (`pendingEvaluationFor`), so if that list changes between the failed confirm
// and the retry (a `refresh()` fired by ANY other flow — a postpone on a different plant, a poll, anything
// that re-reads 'today'), the retry would recompute a DIFFERENT evaluationId for the SAME idempotency key.
// The server's idempotency interceptor compares the WHOLE body, so a same-key/different-body retry is
// answered 422 FOREVER. The fix (`beginDoneAttempt` freezing the whole envelope on the attempt, U2) must
// make the retry resend the ORIGINAL evaluationId regardless of what the list looks like by then.
describe("pages/index.vue — U2: a retry resends the ORIGINAL evaluationId even after an intervening refresh()", () => {
  it("changes the pending evaluation between the failed confirm and the retry, and the retry still sends " +
    "the FIRST evaluationId", async () => {
    const tasksRef = ref([
      { plantId: 'A', task: 'REPOT' as const, nextDueOn: '2026-01-01', pendingEvaluation: { id: 'ev-1', verdict: 'REPOT' as const } },
    ]);
    const refreshTasks = vi.fn(async () => {
      // Simulates an INTERVENING refresh() — from any other flow — that resolves a DIFFERENT pending
      // evaluation for the same plant by the time of the retry.
      tasksRef.value = [
        { plantId: 'A', task: 'REPOT' as const, nextDueOn: '2026-01-01', pendingEvaluation: { id: 'ev-2', verdict: 'REPOT' as const } },
      ];
    });
    vi.stubGlobal('useAsyncData', async (key: string, fn: () => Promise<unknown>) => {
      if (key === 'today') return { data: tasksRef, refresh: refreshTasks };
      return { data: ref(await fn()), refresh: vi.fn(async () => {}) };
    });

    const w = await mountPage();

    await w.find('.done-btn').trigger('click');
    await flushPromises();
    await w.find('.confirm-btn').trigger('click');
    await flushPromises();
    completeRepotDeferreds.A!.reject(new Error('lost response'));
    await flushPromises();

    expect(completeRepotMock).toHaveBeenCalledTimes(1);
    const firstPayload = completeRepotMock.mock.calls[0]![2] as { evaluationId?: string };
    expect(firstPayload.evaluationId).toBe('ev-1');

    // Some OTHER flow refreshes the Today list before the retry — the pending evaluation now reads 'ev-2'.
    await refreshTasks();
    await flushPromises();

    // The retry must still send the ORIGINAL evaluationId, never the one the intervening refresh() surfaced.
    await w.find('.confirm-btn').trigger('click');
    await flushPromises();
    expect(completeRepotMock).toHaveBeenCalledTimes(2);
    const secondPayload = completeRepotMock.mock.calls[1]![2] as { evaluationId?: string };
    expect(secondPayload.evaluationId).toBe('ev-1');
  });
});

// W2: `repotError` used to be ONE boolean shared by the evaluation submit, the Done confirm, AND the
// loaders, while attempts became per-plant (U1). Two plants sharing the SAME flag meant plant B's failure
// could render on plant A's reopened modal (and the inverse: revisiting B could silently hide A's own,
// still-genuine failure). The fix moves the failure state onto the attempt itself (`RepotAttempt.error`),
// so a computed reading `attemptFor(currentlyShownPlantId)` can only ever surface THAT plant's own state.
describe('pages/index.vue — W2: the mutation-failure state lives on the attempt, never a shared flag', () => {
  it('A is still genuinely in flight, B fails: returning to A shows NO error and NO "start over" — A\'s ' +
    'own in-flight state must never be overwritten by B\'s unrelated failure', async () => {
    const w = await mountPage();
    const evaluateButtons = w.findAll('.evaluate-btn');

    // A: open + submit, left GENUINELY in flight — never resolved for the rest of this test.
    await evaluateButtons[0]!.trigger('click');
    await flushPromises();
    await w.find('.submit-btn').trigger('click');
    await flushPromises();
    expect(submitRepotEvaluationMock.mock.calls[0]![0]).toBe('A');

    // B: open + submit + FAIL.
    await evaluateButtons[1]!.trigger('click');
    await flushPromises();
    await w.find('.submit-btn').trigger('click');
    await flushPromises();
    submitDeferreds.B!.reject(new Error('lost response'));
    await flushPromises();
    expect(w.find('.eval-modal').attributes('data-error')).toBeTruthy(); // B's OWN failure, showing now
    expect(w.find('.eval-modal').attributes('data-frozen')).toBe('true');

    // Return to A: A's OWN submit is STILL in flight (never resolved) — no error, no "start over", and the
    // modal must show it is still submitting (never B's error, never B's frozen-with-error state).
    await evaluateButtons[0]!.trigger('click');
    await flushPromises();
    expect(w.find('.eval-modal').attributes('data-error')).toBeFalsy();
    expect(w.find('.eval-modal').attributes('data-submitting')).toBe('true');

    // "start over" is offered only once frozen AND error is showing (RepotEvaluationModal.vue's own gate);
    // asserting no error here is what proves the affordance would not even be offered for A right now.
  });

  it('A fails, the owner opens B instead of retrying: returning to A still shows ITS OWN error and its ' +
    'OWN "start over" — visiting B must never silently clear A\'s genuine failure', async () => {
    const w = await mountPage();
    const evaluateButtons = w.findAll('.evaluate-btn');

    // A: open + submit + FAIL.
    await evaluateButtons[0]!.trigger('click');
    await flushPromises();
    await w.find('.submit-btn').trigger('click');
    await flushPromises();
    submitDeferreds.A!.reject(new Error('lost response'));
    await flushPromises();
    expect(w.find('.eval-modal').attributes('data-error')).toBeTruthy();
    expect(w.find('.eval-modal').attributes('data-frozen')).toBe('true');

    // The owner does NOT choose "start over" — they simply open B's evaluation instead. A genuinely fresh,
    // unrelated attempt: no error yet, not frozen.
    await evaluateButtons[1]!.trigger('click');
    await flushPromises();
    expect(w.find('.eval-modal').attributes('data-error')).toBeFalsy();
    expect(w.find('.eval-modal').attributes('data-frozen')).toBe('false');

    // Return to A: A's OWN failure must still show, exactly as the owner left it.
    await evaluateButtons[0]!.trigger('click');
    await flushPromises();
    expect(w.find('.eval-modal').attributes('data-error')).toBeTruthy();
    expect(w.find('.eval-modal').attributes('data-frozen')).toBe('true');
  });
});

// X2: the OLD version of this block defined `statefulDoneFormStub` — a hand-rolled component that
// REIMPLEMENTED RepotDoneForm.vue's own `watch(open, frozen, frozenSnapshot)` hydration logic inside the
// TEST ITSELF, then asserted against that reimplementation. Deleting the real hydration in
// components/ui/RepotDoneForm.vue would never have made THAT test fail — it only proved the copy was
// internally consistent with itself, never that the real component does the same thing. This block now
// mounts the REAL `RepotDoneForm.vue` (its own component-level frozenSnapshot coverage lives in
// RepotDoneForm.test.ts's "W3" describe block — this is the ONE parent-level integration assertion tying
// the real component's RENDERED values to the ACTUAL api arguments pages/index.vue sends).
describe("pages/index.vue — W3: the frozen Done form displays what the retry will actually send " +
  "(mounts the REAL RepotDoneForm.vue, never a reimplementation of its hydration)", () => {
  // Modal/Button/FormGroup stubbed (same shape as RepotDoneForm.test.ts's own stubsWithRealInputs()); Input/
  // SelectField/SegmentedControl are left OUT of the stub map on purpose, so the REAL components render and
  // their actual DOM values (input[type=number], select, .mp-seg button) are what this test asserts against.
  const realDoneFormStubs = {
    ...stubs,
    UiRepotDoneForm: RealRepotDoneForm,
    Modal: {
      props: ['modelValue', 'title'],
      template: '<div data-modal-stub v-if="modelValue"><slot /><slot name="footer" /></div>',
    },
    Button: { props: ['disabled', 'icon', 'loading'], template: '<button :disabled="disabled"><slot /></button>' },
    FormGroup: { props: ['label', 'hint'], template: '<div><slot /></div>' },
    AppIcon: true,
  };

  async function mountPageWithRealDoneForm() {
    const TodayPage = (await import('./index.vue')).default;
    const w = mount(
      { components: { TodayPage }, template: '<Suspense><TodayPage /></Suspense>' },
      { global: { stubs: realDoneFormStubs, mocks: { $t: (k: string) => k } } },
    );
    await flushPromises();
    return w;
  }

  function findConfirmButton(w: ReturnType<typeof mount>) {
    return w.findAll('button').find((b) => b.text().includes('repotDone.confirm'))!;
  }

  it("A fails and freezes; B is opened and closed WITHOUT confirming; returning to A RENDERS A's ORIGINAL " +
    "values (never B's leftover ones) — and the retry then resends the EXACT rendered values, byte-identical " +
    "to the original request", async () => {
    const w = await mountPageWithRealDoneForm();
    const doneButtons = w.findAll('.done-btn');

    // Open A: the REAL form's fields hydrate to A's OWN profile (PLANT_PROFILES.A = potSizeCm 20 / soilMix
    // 'potting-mix') — rendered DOM values, not an internal ref.
    await doneButtons[0]!.trigger('click');
    await flushPromises();
    expect((w.find('input[type="number"]').element as HTMLInputElement).value).toBe('20');
    expect((w.find('select').element as HTMLSelectElement).value).toBe('potting-mix');

    // Confirm A: the request is lost/rejected, so the key + body + error are kept and the form freezes.
    await findConfirmButton(w).trigger('click');
    await flushPromises();
    completeRepotDeferreds.A!.reject(new Error('lost response'));
    await flushPromises();
    expect(completeRepotMock).toHaveBeenCalledTimes(1);
    const firstCall = completeRepotMock.mock.calls[0]!;
    expect(w.find('input[type="number"]').attributes('disabled')).toBeDefined(); // frozen — disabled

    // Close A WITHOUT choosing "start over" — the real Modal's own close affordance. The stub renders no
    // close control of its own, so drive it the same way the app does: the header's X button. Since Modal is
    // stubbed here (bare passthrough), simulate the parent's real "start over"-free close via v-model — the
    // page's own onRepotDone/onRepotDoneConfirm never calls this directly, so exercise it through the ACTUAL
    // v-model:open contract pages/index.vue binds (`v-model:open="doneFormOpen"`), by finding the real
    // component instance and setting its own open prop false — mirroring X/Escape/backdrop.
    const realFormVm = w.findComponent(RealRepotDoneForm);
    realFormVm.vm.$emit('update:open', false);
    await flushPromises();
    expect(w.find('[data-modal-stub]').exists()).toBe(false);

    // Open B instead: a genuinely fresh attempt, correctly RENDERING B's OWN profile (25 / 'cactus-mix') —
    // this is what overwrites the SAME shared form instance's own internal fields.
    await doneButtons[1]!.trigger('click');
    await flushPromises();
    expect((w.find('input[type="number"]').element as HTMLInputElement).value).toBe('25');
    expect((w.find('select').element as HTMLSelectElement).value).toBe('cactus-mix');
    expect(w.find('input[type="number"]').attributes('disabled')).toBeUndefined(); // B is unfrozen

    // Close B WITHOUT confirming — the owner never touched B's completion at all.
    w.findComponent(RealRepotDoneForm).vm.$emit('update:open', false);
    await flushPromises();

    // Reopen A: resumes (still frozen, same outstanding key). W3 — the RENDERED values must be A's ORIGINAL
    // submission, never B's leftover values still sitting in the shared form instance's own local state.
    await doneButtons[0]!.trigger('click');
    await flushPromises();
    expect(w.find('input[type="number"]').attributes('disabled')).toBeDefined();
    expect((w.find('input[type="number"]').element as HTMLInputElement).value).toBe('20');
    expect((w.find('select').element as HTMLSelectElement).value).toBe('potting-mix');

    // ONE parent-level integration assertion: the retry sends the byte-identical ORIGINAL request to the
    // ACTUAL api mock — same plantId, occurredOn, payload, and key — and that payload equals exactly what
    // was just RENDERED (potSizeCm 20 / soilMix 'potting-mix'), never a value the real component merely
    // claims to show.
    await findConfirmButton(w).trigger('click');
    await flushPromises();
    expect(completeRepotMock).toHaveBeenCalledTimes(2);
    const secondCall = completeRepotMock.mock.calls[1]!;
    expect(secondCall[0]).toBe(firstCall[0]);
    expect(secondCall[1]).toBe(firstCall[1]);
    expect(secondCall[2]).toEqual(firstCall[2]);
    expect(secondCall[2]).toEqual(expect.objectContaining({ potSizeCm: 20, soilMix: 'potting-mix' }));
    expect(secondCall[3]).toBe(firstCall[3]);
  });
});

// Z1: wave 9 introduced the shared completion signal (X1) but gated its watcher's `refresh()` call on the
// SAME check that gates the modal-close/verdict actions ("is this the plant the ONE shared modal is
// currently showing?"). `resolveSuccess()` has already deleted the completed plant's attempt by the time the
// watcher runs, REGARDLESS of what the modal is currently showing — so the early return silently skipped
// the Today refresh too, leaving a plant the owner isn't currently looking at stale with its attempt gone:
// its own card's next click minted a FRESH idempotency key and could duplicate the already-recorded repot.
// These tests reproduce the exact scenario the ruling describes: confirm plant A, dismiss/abandon its
// in-flight form by opening plant B's WITHOUT submitting, then let A settle — Today must still refresh, B
// must stay open and untouched, and reopening A must never resume a stale, already-cleared attempt.
describe('Z1 — the REFRESH must never be gated on modal ownership', () => {
  it('evaluation flow: plant A\'s submit settles while plant B\'s UNSUBMITTED modal is open — Today ' +
    'refreshes, B stays open and untouched, and reopening A is a genuinely FRESH attempt', async () => {
    // A spy on the fetcher itself (not just the `refresh()` wrapper) is what proves the Today list actually
    // re-fetched — asserting on the `refresh()` mock would only prove it was CALLED, never that it re-ran
    // the real fetcher, and this override makes `refresh()` do that (mirrors the cross-renderer test file's
    // own `useAsyncData` stub, documented there as the generic reason to assert on the underlying api mock's
    // call count, never on the refresh() wrapper itself).
    const todaysTasksMock = vi.fn(async () => TASKS);
    vi.stubGlobal('useAsyncData', async (_key: string, fn: () => Promise<unknown>) => {
      const data = ref(await fn());
      return { data, refresh: vi.fn(async () => { data.value = await fn(); }) };
    });
    vi.stubGlobal('useApi', () => ({
      todaysTasks: todaysTasksMock,
      listPlants: async () => [],
      listPlaces: async () => [],
      getRepotSigns: getRepotSignsMock,
      submitRepotEvaluation: submitRepotEvaluationMock,
      getPlant: getPlantMock,
      completeRepot: completeRepotMock,
      getOwnerInstruments: getOwnerInstrumentsMock,
      getSoilReadings: getSoilReadingsMock,
    }));

    const w = await mountPage();
    const evaluateButtons = w.findAll('.evaluate-btn');

    // Confirm plant A: open + submit — mints a key, the request is in flight (never resolved yet).
    await evaluateButtons[0]!.trigger('click');
    await flushPromises();
    await w.find('.submit-btn').trigger('click');
    await flushPromises();
    expect(submitRepotEvaluationMock.mock.calls[0]![0]).toBe('A');

    // Open plant B's card WITHOUT submitting — abandons A's modal ownership (the shared modal now shows B),
    // but A's request keeps running underneath.
    await evaluateButtons[1]!.trigger('click');
    await flushPromises();
    expect(w.find('.eval-modal').attributes('data-open')).toBe('true');
    expect(w.find('.eval-modal').attributes('data-frozen')).toBe('false'); // fresh, unsubmitted B attempt

    const tasksReadsBeforeCompletion = todaysTasksMock.mock.calls.length;

    // A's response now arrives while B's UNSUBMITTED modal is showing.
    submitDeferreds.A!.resolve({ evaluationId: 'ev-A', verdict: 'REPOT' });
    await flushPromises();

    // The Today list must reconcile regardless — B's modal is not A's, but the refresh is unconditional.
    expect(todaysTasksMock.mock.calls.length).toBeGreaterThan(tasksReadsBeforeCompletion);
    // B stays open and untouched: no verdict shown for A's response, B's own modal state undisturbed.
    expect(w.find('.eval-modal').attributes('data-open')).toBe('true');
    expect(w.find('.verdict-modal').attributes('data-open')).toBe('false');

    // Reopening A offers no stale duplicate action: A's attempt was cleared by resolveSuccess(), so this is
    // a genuinely FRESH (unfrozen) attempt, never a resume of the already-completed one.
    await evaluateButtons[0]!.trigger('click');
    await flushPromises();
    expect(w.find('.eval-modal').attributes('data-open')).toBe('true');
    expect(w.find('.eval-modal').attributes('data-frozen')).toBe('false');
  });

  it('Done flow: plant A\'s confirm settles while plant B\'s UNSUBMITTED Done form is open — Today ' +
    'refreshes, B stays open and untouched, and reopening A is a genuinely FRESH attempt', async () => {
    const todaysTasksMock = vi.fn(async () => TASKS);
    vi.stubGlobal('useAsyncData', async (_key: string, fn: () => Promise<unknown>) => {
      const data = ref(await fn());
      return { data, refresh: vi.fn(async () => { data.value = await fn(); }) };
    });
    vi.stubGlobal('useApi', () => ({
      todaysTasks: todaysTasksMock,
      listPlants: async () => [],
      listPlaces: async () => [],
      getRepotSigns: getRepotSignsMock,
      submitRepotEvaluation: submitRepotEvaluationMock,
      getPlant: getPlantMock,
      completeRepot: completeRepotMock,
      getOwnerInstruments: getOwnerInstrumentsMock,
      getSoilReadings: getSoilReadingsMock,
    }));

    const w = await mountPage();
    const doneButtons = w.findAll('.done-btn');

    // Confirm plant A: open + confirm — mints a key, the request is in flight (never resolved yet).
    await doneButtons[0]!.trigger('click');
    await flushPromises();
    await w.find('.confirm-btn').trigger('click');
    await flushPromises();
    expect(completeRepotMock.mock.calls[0]![0]).toBe('A');

    // Open plant B's Done form WITHOUT confirming.
    await doneButtons[1]!.trigger('click');
    await flushPromises();
    expect(w.find('.done-form').attributes('data-open')).toBe('true');
    expect(w.find('.done-form').attributes('data-frozen')).toBe('false'); // fresh, unconfirmed B attempt

    const tasksReadsBeforeCompletion = todaysTasksMock.mock.calls.length;

    // A's response now arrives while B's UNCONFIRMED form is showing.
    completeRepotDeferreds.A!.resolve({ ok: true });
    await flushPromises();

    // The Today list must reconcile regardless.
    expect(todaysTasksMock.mock.calls.length).toBeGreaterThan(tasksReadsBeforeCompletion);
    // B stays open and untouched.
    expect(w.find('.done-form').attributes('data-open')).toBe('true');

    // Reopening A offers no stale duplicate action: A's attempt was cleared, so this is a genuinely FRESH
    // (unfrozen) attempt.
    await doneButtons[0]!.trigger('click');
    await flushPromises();
    expect(w.find('.done-form').attributes('data-open')).toBe('true');
    expect(w.find('.done-form').attributes('data-frozen')).toBe('false');
  });
});

// Owner request, 2026-08-07: `/plants/:id` gained a standalone "Done" beside "Time to evaluate", and the
// owner's requirement was explicit — "The Today page does not change." Today is a triage list: one action
// per card, and Done appears only once a verdict has decided the repot is needed. This is the guard that
// goes RED if that ever leaks here.
describe('pages/index.vue — Today must NOT offer the standalone REPOT Done (owner requirement 2026-08-07)', () => {
  it('never passes allowStandaloneDone to any task row', async () => {
    const w = await mountPage();
    const rows = w.findAll('[data-allow-standalone-done]');
    expect(rows.length).toBeGreaterThan(0); // a vacuous pass on zero rows would prove nothing
    expect(rows.map((r) => r.attributes('data-allow-standalone-done'))).toEqual(rows.map(() => 'false'));
  });
});

// The other half of the 2026-08-07 change, on THIS renderer: the verdict modal cannot name a corroborating
// sign unless the ids the owner ticked actually reach it. PlantDetail.vue carries the identical line.
describe('pages/index.vue — the ticked sign ids reach the verdict modal', () => {
  it('forwards the submitted signIds and the fetched catalogue after a checked-signs submit', async () => {
    getRepotSignsMock = vi.fn(async () => ({
      signs: [
        { id: 's1', label: 'one', help: null, evidence: 'strong' },
        { id: 's2', label: 'two', help: null, evidence: 'ambiguous' },
      ] as unknown as RepotSign[],
      typicalIntervalMonths: null,
    }));
    vi.stubGlobal('useApi', () => ({
      todaysTasks: async () => TASKS,
      listPlants: async () => [],
      listPlaces: async () => [],
      getRepotSigns: getRepotSignsMock,
      submitRepotEvaluation: submitRepotEvaluationMock,
      getPlant: getPlantMock,
      completeRepot: completeRepotMock,
      getOwnerInstruments: getOwnerInstrumentsMock,
      getSoilReadings: getSoilReadingsMock,
    }));

    const w = await mountPage();
    await w.findAll('.evaluate-btn')[0]!.trigger('click');
    await flushPromises();
    await w.find('.submit-signs-btn').trigger('click');
    await flushPromises();
    submitDeferreds.A!.resolve({ evaluationId: 'ev-A', verdict: 'RE-EVALUATE', reevaluateOn: '2026-11-05' });
    await flushPromises();

    const modal = w.find('.verdict-modal');
    expect(modal.attributes('data-open')).toBe('true');
    expect(modal.attributes('data-checked')).toBe('s1');
    expect(modal.attributes('data-signs')).toBe('2');
  });
});

// FIX D3 (independent review of the 2026-08-07 wave, finding 3). `verdict`, `answer` and `checkedSignIds`
// all come from the plant-keyed completion record; the `signs` catalogue the verdict modal ranks a
// corroborating sign out of came from a single PAGE-LEVEL ref instead. `onEvaluate` moves
// `evaluationPlantId` to the new plant BEFORE the signs fetch, and a FAILED fetch returns without touching
// the catalogue — so the id names plant B while the list still holds plant A's rows. Sign ids are
// species-namespaced, so the already-ticked subtraction would remove nothing and the suggestion could name a
// sign from the WRONG SPECIES.
//
// HONESTY: no click sequence that reaches the wrong SUGGESTION was found (the modal blocks the cards while a
// submit is in flight), so this is hardening, not a caught defect. The mismatch WINDOW itself is reachable
// and is asserted directly below; the completion-side lookup is asserted through the cross-renderer path the
// completion log exists for (a submit issued on the plant page settling while Today is mounted).
describe('pages/index.vue — FIX D3: the signs catalogue is looked up BY PLANT, never read off the page', () => {
  const catalogueA = [
    { id: 'A-s1', label: 'one', help: null, evidence: 'strong' },
    { id: 'A-s2', label: 'two', help: null, evidence: 'ambiguous' },
  ] as unknown as RepotSign[];

  async function mountWithFailingSecondFetch() {
    let call = 0;
    getRepotSignsMock = vi.fn(async () => {
      // A non-null interval, so a leak of A's record into B's modal is DISTINGUISHABLE from an empty one.
      if (call++ === 0) return { signs: catalogueA, typicalIntervalMonths: 18 };
      throw new Error('signs fetch failed');
    });
    vi.stubGlobal('useApi', () => ({
      todaysTasks: async () => TASKS,
      listPlants: async () => [],
      listPlaces: async () => [],
      getRepotSigns: getRepotSignsMock,
      submitRepotEvaluation: submitRepotEvaluationMock,
      getPlant: getPlantMock,
      completeRepot: completeRepotMock,
      getOwnerInstruments: getOwnerInstrumentsMock,
      getSoilReadings: getSoilReadingsMock,
    }));
    const w = await mountPage();
    // A's fetch succeeds: the catalogue on hand belongs to A.
    await w.findAll('.evaluate-btn')[0]!.trigger('click');
    await flushPromises();
    expect(w.find('.eval-modal').attributes('data-sign-ids')).toBe('A-s1,A-s2');
    // B's fetch FAILS: `evaluationPlantId` has already moved to B, and nothing updated the catalogue.
    await w.findAll('.evaluate-btn')[1]!.trigger('click');
    await flushPromises();
    return w;
  }

  it('after a FAILED signs fetch for another plant, the questionnaire holds NO catalogue — never the ' +
    'previous plant\'s rows', async () => {
    const w = await mountWithFailingSecondFetch();
    expect(w.find('.eval-modal').attributes('data-sign-ids')).toBe('');
  });

  // B1 of the 2026-08-07 review. The claim above ("every reader looks it up BY PLANT") was true of the SIGNS
  // and enforced separately for the interval, which restated the plant comparison inline against the
  // catalogue ref. Behaviourally equivalent — and that is the point: the guard existed at TWO sites rather
  // than being unrepresentable, so a third reader reintroduced the window simply by forgetting it.
  // `catalogueFor(plantId)` returns the WHOLE record, so there is nothing left to dereference unguarded.
  it('the informative typical-interval is looked up BY PLANT too, not only the signs', async () => {
    const w = await mountWithFailingSecondFetch();
    // A's fetch returned 18 months; B's failed. The questionnaire, now showing B, must state no interval —
    // never A's, which belongs to a different species.
    expect(w.find('.eval-modal').attributes('data-typical')).toBe('none');
  });

  it('the verdict modal is handed the catalogue of the COMPLETION\'s own plant — a completion for a plant ' +
    'whose catalogue was never fetched gets none, never the one still sitting on the page', async () => {
    const w = await mountWithFailingSecondFetch();

    // A completion for B arriving while this page is mounted — the cross-renderer case the shared completion
    // log exists for (a submit issued on B's detail page whose response settles after navigating here).
    const handle = useRepotAttempt<{ answer: string; signIds: string[] }, RepotEvaluationResult>('evaluation');
    const attempt = handle.begin('B', { answer: 'signs', signIds: ['B-s1'] });
    handle.resolveSuccess(attempt, { evaluationId: 'ev-B', verdict: 'RE-EVALUATE', reevaluateOn: '2026-11-05' });
    await flushPromises();

    const modal = w.find('.verdict-modal');
    expect(modal.attributes('data-open')).toBe('true'); // B IS the plant the shared modal is showing
    expect(modal.attributes('data-checked')).toBe('B-s1');
    expect(modal.attributes('data-signs')).toBe('0'); // NOT A's two rows
  });
});

// Plan 3 T5: the WATER row stops being a bare instruction and offers "Do you need to water?" first — but
// ONLY when the owner actually has an instrument selected in Settings. `canSurvey` is derived from the SAME
// owner-level selection Settings itself reads/writes (`api.getOwnerInstruments()`), never a second,
// invented fetch, and an owner with none renders the row EXACTLY as it did before this feature — declining
// to measure is a supported choice, not a degraded state.
const WATER_TASK_A = { plantId: 'A', task: 'WATER' as const, nextDueOn: '2026-01-01', pendingEvaluation: null };
// measured-verdict-gap spec (Task 47/T6b) — the SAME row, already measured today (WATER_NOW's own write,
// `verdict: 'NONE'`, has already landed). `canSurveyWaterFor` must gate on this too, not just the
// instrument — asking again after the owner already answered is the exact dead end this field closes.
const WATER_TASK_A_MEASURED_TODAY = { ...WATER_TASK_A, measuredToday: true };

function stubApiWithWaterTask(tasks: unknown[] = [WATER_TASK_A]) {
  vi.stubGlobal('useApi', () => ({
    todaysTasks: async () => tasks,
    listPlants: async () => [],
    listPlaces: async () => [],
    getRepotSigns: getRepotSignsMock,
    submitRepotEvaluation: submitRepotEvaluationMock,
    getPlant: getPlantMock,
    completeRepot: completeRepotMock,
    getOwnerInstruments: getOwnerInstrumentsMock,
    getSoilReadings: getSoilReadingsMock,
  }));
}

describe('pages/index.vue — Plan 3 T5: the WATER row asks before it instructs, gated on canSurvey', () => {
  it('offers the survey on a WATER row when the owner has an instrument', async () => {
    getOwnerInstrumentsMock = vi.fn(async () => ({ available: [], selected: ['galvanic-probe'] }));
    stubApiWithWaterTask();

    const w = await mountPage();
    const row = w.find('[data-can-survey]');
    expect(row.attributes('data-can-survey')).toBe('true');
    // The survey affordance renders; Done/Postpone stay withheld until the survey answers.
    expect(row.find('.evaluate-btn').exists()).toBe(true);
    expect(row.find('.done-btn').exists()).toBe(false);
    expect(row.find('.postpone-btn').exists()).toBe(false);
  });

  // THE LOAD-BEARING CASE — an owner who selected no instrument has no way to satisfy a survey; the row
  // must stay byte-identical to today (Done AND Postpone, no survey), or he is locked out of marking a
  // watering done over a feature he declined.
  it('leaves the WATER row exactly as it is today when he has none', async () => {
    getOwnerInstrumentsMock = vi.fn(async () => ({ available: [], selected: [] as string[] }));
    stubApiWithWaterTask();

    const w = await mountPage();
    const row = w.find('[data-can-survey]');
    expect(row.attributes('data-can-survey')).toBe('false');
    expect(row.find('.evaluate-btn').exists()).toBe(false);
    expect(row.find('.done-btn').exists()).toBe(true);
    expect(row.find('.postpone-btn').exists()).toBe(true);
  });

  // measured-verdict-gap spec (Task 47/T6b) — the ground truth is the READING, not session memory: once
  // WATER_NOW has written today's reading, the row must fall back to the classic Done | Postpone pair,
  // exactly as an owner with no instrument sees, even though this owner DOES have one selected.
  it('withholds the survey once the plant has already been measured today, even with an instrument', async () => {
    getOwnerInstrumentsMock = vi.fn(async () => ({ available: [], selected: ['galvanic-probe'] }));
    stubApiWithWaterTask([WATER_TASK_A_MEASURED_TODAY]);

    const w = await mountPage();
    const row = w.find('[data-can-survey]');
    expect(row.attributes('data-can-survey')).toBe('false');
    expect(row.find('.evaluate-btn').exists()).toBe(false);
    expect(row.find('.done-btn').exists()).toBe(true);
    expect(row.find('.postpone-btn').exists()).toBe(true);
  });

  it('opens the modal in SURVEY mode', async () => {
    getOwnerInstrumentsMock = vi.fn(async () => ({ available: [], selected: ['galvanic-probe'] }));
    stubApiWithWaterTask();

    const w = await mountPage();
    await w.find('.evaluate-btn').trigger('click');
    await flushPromises();

    const modal = w.find('.soil-modal');
    expect(modal.attributes('data-open')).toBe('true');
    expect(modal.attributes('data-mode')).toBe('survey');
    expect(modal.attributes('data-plant-id')).toBe('A');
  });

  // Mutation proof 3 (Step 4): a survey's HOLD verdict applies itself and writes a postpone, and WATER_NOW
  // writes the reading too (`verdict: 'NONE'`, measured-verdict-gap redesign 2026-08-09) — both inside
  // SoilReadingModal.vue's own `submit()`. The ONE signal Today gets that something was written is the
  // `saved` event. Today must reconcile through the SAME `refresh()` seam every other completion already
  // uses, never a second refresh path — this is what lets a WATER_NOW save flip `measuredToday` and close
  // the survey affordance back to false without a manual page reload.
  it('reconciles Today through the existing refresh() seam once the survey reports a save', async () => {
    getOwnerInstrumentsMock = vi.fn(async () => ({ available: [], selected: ['galvanic-probe'] }));
    const todaysTasksMock = vi.fn(async () => [WATER_TASK_A]);
    vi.stubGlobal('useAsyncData', async (_key: string, fn: () => Promise<unknown>) => {
      const data = ref(await fn());
      return { data, refresh: vi.fn(async () => { data.value = await fn(); }) };
    });
    vi.stubGlobal('useApi', () => ({
      todaysTasks: todaysTasksMock,
      listPlants: async () => [],
      listPlaces: async () => [],
      getRepotSigns: getRepotSignsMock,
      submitRepotEvaluation: submitRepotEvaluationMock,
      getPlant: getPlantMock,
      completeRepot: completeRepotMock,
      getOwnerInstruments: getOwnerInstrumentsMock,
      getSoilReadings: getSoilReadingsMock,
    }));

    const w = await mountPage();
    await w.find('.evaluate-btn').trigger('click');
    await flushPromises();

    const tasksReadsBeforeSave = todaysTasksMock.mock.calls.length;
    await w.find('.soil-save-btn').trigger('click');
    await flushPromises();

    expect(todaysTasksMock.mock.calls.length).toBeGreaterThan(tasksReadsBeforeSave);
  });
});
