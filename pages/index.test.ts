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
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { computed, inject, ref, shallowRef, watch } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import type { CareWriteResult, PlantSoilReadings, RepotDoneResult, RepotEvaluationResult, RepotSign } from '../types/api.js';
import type { TodaysVerdict } from '../utils/waterSurvey.js';
// Task 10: names "today" the same way the page itself does (`utils/localDate.js`'s `todayYmd()`), so the
// fixture's `occurredOn` genuinely lands on the SAME-DAY path rather than an accidental back-dated one.
import { todayYmd, ymdToLocalDate } from '../utils/localDate.js';
// X2: the parent-level integration test near the end of this file mounts the REAL RepotDoneForm.vue (never a
// re-implemented stub of its hydration watcher — see that describe block's own header comment for why).
import RealRepotDoneForm from '../components/ui/RepotDoneForm.vue';
// Task 2 (spec §5.1): the real row, imported directly and swapped in as the `UiTaskRow` stub VALUE below —
// the tag has nothing else to resolve to under plain vitest (neither this file's mounted `pages/index.vue`
// nor `PlantDetail.vue` imports it; Nuxt's directory-based auto-import only registers it at build time). Same
// technique `PlantDetail.test.ts` (Task 3) and `TaskRow.test.ts` already use.
import TaskRow from '../components/ui/TaskRow.vue';
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
// The real `TaskRow.vue` is mounted in this file now (spec §5.1), and it imports `useTaskMeta` through an
// EXPLICIT `~/composables/useTaskMeta` path — `vi.stubGlobal` only intercepts a global reference, never an
// import statement, so the module itself has to be mocked. Same technique as `TaskRow.test.ts`.
vi.mock('~/composables/useTaskMeta', () => ({
  useTaskMeta: () => ({
    TASK_ICONS: {
      WATER: 'droplet', FERTILIZE: 'beaker', REPOT: 'magnifying-glass',
      ROTATE: 'arrow-path', CLEAN_LEAVES: 'sparkles', MIST: 'cloud', PROGRESS: 'camera',
    },
    taskLabel: (t: string) => t,
    dueLabel: () => 'Today',
    dueLabelLong: () => 'Today',
  }),
}));
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

type Verdict = { id: string; verdict: 'REPOT' | 'RE-EVALUATE'; reevaluateOn: string | null } | null;
// ⚠️ THE FIXTURE THE STUB MADE UNNECESSARY (spec §5.1). Today offers a REPOT Done ONLY once a verdict has
// decided the repot is needed — with `pendingEvaluation: null` the real row shows the questionnaire and
// NOTHING else. The deleted stub rendered a Done button unconditionally, so every Done-flow case in this
// file was driving an affordance production never offers for that state. The flows below are unchanged;
// the plant they describe is now one the API can actually produce.
const repotTasks = (verdict: Verdict) => [
  { plantId: 'A', task: 'REPOT' as const, nextDueOn: '2026-01-01', pendingEvaluation: verdict && { ...verdict } },
  { plantId: 'B', task: 'REPOT' as const, nextDueOn: '2026-01-01', pendingEvaluation: verdict && { ...verdict } },
];
const RESOLVED: Verdict = { id: 'ev-resolved', verdict: 'REPOT', reevaluateOn: null };
let tasksFixture: ReturnType<typeof repotTasks> = repotTasks(RESOLVED);

const PLANT_PROFILES: Record<string, { potSizeCm: number; soilMix: string }> = {
  A: { potSizeCm: 20, soilMix: 'potting-mix' },
  B: { potSizeCm: 25, soilMix: 'cactus-mix' },
};

let getRepotSignsMock: ReturnType<typeof vi.fn>;
let submitDeferreds: Record<string, ReturnType<typeof deferred<RepotEvaluationResult>>>;
let submitRepotEvaluationMock: ReturnType<typeof vi.fn>;
let getPlantMock: ReturnType<typeof vi.fn>;
// `RepotDoneResult`, not `CareWriteResult`: a REPOT completion also reports what the substrate clock did
// (owner ruling, 2026-08-14; API finding E8), and the fixtures below carry that second outcome.
let completeRepotDeferreds: Record<string, ReturnType<typeof deferred<RepotDoneResult>>>;
let completeRepotMock: ReturnType<typeof vi.fn>;
// Plan 3 T5: the WATER survey's own two api calls. Defaulted to "the owner selected nothing" / "an empty
// per-plant reading catalogue" so every PRE-EXISTING (REPOT-focused) test in this file — which never touches
// either — keeps passing unmodified; the WATER-specific describe block below overrides them per test.
let getOwnerInstrumentsMock: ReturnType<typeof vi.fn>;
let getSoilReadingsMock: ReturnType<typeof vi.fn>;
// W2: the ONE seam every Done/Postpone on this page writes through — the WATER postpone tests below read
// the recorded `reason` off it. Every pre-existing test ignores it.
let sendFeedbackMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  // Store-isolation (W1): reset BOTH module-scope attempt stores before every test so no test's outstanding
  // key/body/error survives into the next one.
  __resetRepotAttemptStoresForTests();
  // Task 2, step 3: the DEFAULT fixture is a RESOLVED verdict — the state in which Today actually offers
  // Done — since that is the shape most of this file's Done-form tests describe. A test whose subject is
  // the QUESTIONNAIRE itself (onEvaluate, the verdict modal, the signs) sets `tasksFixture = repotTasks(null)`
  // at the top of its own `it`.
  tasksFixture = repotTasks(RESOLVED);
  submitDeferreds = { A: deferred<RepotEvaluationResult>(), B: deferred<RepotEvaluationResult>() };
  completeRepotDeferreds = { A: deferred<RepotDoneResult>(), B: deferred<RepotDoneResult>() };
  getRepotSignsMock = vi.fn(async () => ({ signs: [] as RepotSign[] }));
  submitRepotEvaluationMock = vi.fn(async (plantId: string) => submitDeferreds[plantId].promise);
  getPlantMock = vi.fn(async (plantId: string) => ({ profile: PLANT_PROFILES[plantId] }));
  completeRepotMock = vi.fn(async (plantId: string) => completeRepotDeferreds[plantId].promise);
  getOwnerInstrumentsMock = vi.fn(async () => ({ available: [], selected: [] as string[] }));
  getSoilReadingsMock = vi.fn(async () => (
    { instruments: [], protocol: null, readings: [], wateringDays: [] } as unknown as PlantSoilReadings
  ));
  sendFeedbackMock = vi.fn(async () => ({ ok: true, outcome: { status: 'applied' } } as CareWriteResult));

  // UiSoilReadingModal reads the route to decide push-vs-replace for its calibration link.
vi.stubGlobal('useRoute', () => ({ path: '/', query: {} }));
vi.stubGlobal('useApi', () => ({
    todaysTasks: async () => tasksFixture,
    listPlants: async () => [],
    listPlaces: async () => [],
    getRepotSigns: getRepotSignsMock,
    submitRepotEvaluation: submitRepotEvaluationMock,
    getPlant: getPlantMock,
    completeRepot: completeRepotMock,
    getOwnerInstruments: getOwnerInstrumentsMock,
    getSoilReadings: getSoilReadingsMock,
    sendFeedback: sendFeedbackMock,
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
  // W1: `data-description` exposes WHICH banner this is — the page now renders a second one (the WATER
  // survey's own load failure), and "an alert appeared" is not the assertion; "the alert said the honest
  // thing" is. The two are mutually exclusive in practice, so no existing `.repot-error-banner` lookup moves.
  UiAlert: {
    props: ['color', 'description', 'announce'],
    template: '<div class="repot-error-banner" :data-description="description"><slot /></div>',
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
  // W2: a real stub rather than `true`, so a test can tell "the picker opened" from "the postpone went
  // straight through". Both instances (early-water and postpone) render it; the page's own template order
  // is early first, postpone second.
  UiReasonPicker: {
    props: ['open', 'title', 'options', 'confirmLabel'],
    emits: ['update:open', 'confirm'],
    template: '<div class="reason-picker" :data-open="String(!!open)" />',
  },
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
  // Task 2 (spec §5.1): the REAL row — never a re-implemented copy of its own `showEvaluate`/`showDone` rules.
  // `TaskRow.vue`'s own three imports resolve via the `AppIcon`/`Badge`/`Button` keys just below (the LOCAL
  // names its own `<script setup>` uses, so they never collide with this file's `UiButton`/`UiAppIcon`).
  UiTaskRow: TaskRow,
  AppIcon: true,
  Badge: { template: '<span class="stub-badge"><slot /></span>' },
  Button: {
    props: ['size', 'color', 'variant', 'icon', 'disabled', 'loading'],
    template: '<button class="stub-btn" :data-icon="icon" :data-variant="variant"><slot /></button>',
  },
  // Plan 3 T5: stands in for the real SoilReadingModal.vue (covered by its own test file) — this file's only
  // concern is that pages/index.vue opens it for the right plant, in the right MODE, and reconciles Today
  // through the SAME `refresh()` seam every other completion already uses (see `onReadingSaved` below and
  // the mutation-proof tests in the WATER describe block).
  // `wateredToday` joined the prop list on 2026-08-11 (F1b's second door). On THIS surface it is the named
  // constant `false` — a watering advances `nextDueOn`, so the API has already dropped the row and there is
  // no Today card left to open this dialog from. `data-watered-today` exposes it so that conclusion is
  // pinned rather than merely written in a comment.
  UiSoilReadingModal: {
    props: ['open', 'plantId', 'data', 'mode', 'wateredToday'],
    emits: ['update:open', 'saved'],
    template:
      '<div class="soil-modal" :data-open="open" :data-mode="mode" :data-plant-id="plantId" '
      + ':data-watered-today="String(wateredToday)">' +
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

// One place that knows how an action is named on a real row, so a future assertion cannot invent a second
// convention. Scoped to a card when a card is passed, whole-page otherwise. `Button` exposes `data-icon`,
// which is how every assertion in this file now names an action: `check` = Done, `magnifying-glass` = the
// survey/questionnaire, `clock` = Postpone. Exactly the convention `TaskRow.test.ts` already uses.
type Findable = { findAll: (s: string) => Array<{ attributes: (a: string) => string | undefined }> };
const byIcon = (w: Findable, icon: string) =>
  (w.findAll('.stub-btn') as any[]).filter((b) => b.attributes('data-icon') === icon);
const doneButtons = (w: Findable) => byIcon(w, 'check');
const evaluateButtons = (w: Findable) => byIcon(w, 'magnifying-glass');
const postponeButtons = (w: Findable) => byIcon(w, 'clock');

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
    tasksFixture = repotTasks(null); // this test's subject is the evaluate/questionnaire flow
    const w = await mountPage();
    const evaluateButtons = byIcon(w, 'magnifying-glass');
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
    tasksFixture = repotTasks(null); // this test's subject is the evaluate/questionnaire flow
    const w = await mountPage();
    const evaluateButtons = byIcon(w, 'magnifying-glass');

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
    const doneButtons = byIcon(w, 'check');

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
    tasksFixture = repotTasks(null); // this test's subject is the evaluate/questionnaire flow
    // A controllable `refresh()` lets the test hold A's success mid-flight (past the point where it has
    // already closed its own modal) so a newer attempt (B) can start DURING that window — exactly the gap
    // where the old code's `finally` clobbered B's flag once A's refresh() finally resolved.
    const refreshDeferred = deferred<void>();
    vi.stubGlobal('useAsyncData', async (_key: string, fn: () => Promise<unknown>) => ({
      data: ref(await fn()),
      refresh: vi.fn(() => refreshDeferred.promise),
    }));

    const w = await mountPage();
    const evaluateButtons = byIcon(w, 'magnifying-glass');

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
    const doneButtons = byIcon(w, 'check');

    // Confirm A; it succeeds, but its refresh() is held open.
    await doneButtons[0]!.trigger('click');
    await flushPromises();
    await w.find('.confirm-btn').trigger('click');
    await flushPromises();
    completeRepotDeferreds.A!.resolve({ ok: true, outcome: { status: 'applied' } });
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
    tasksFixture = repotTasks(null); // this test's subject is the evaluate/questionnaire flow
    const w = await mountPage();
    await byIcon(w, 'magnifying-glass')[0]!.trigger('click');
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
    await byIcon(w, 'check')[0]!.trigger('click');
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
    const doneButtons = byIcon(w, 'check');
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
    completeRepotDeferreds.A!.resolve({ ok: true, outcome: { status: 'applied' } });
    await flushPromises();

    // The abandoned A response must be ignored entirely: B's form stays open and B's confirm is still
    // (from this test's perspective) in flight.
    expect(w.find('.done-form').attributes('data-open')).toBe('true');
    expect(w.find('.done-form').attributes('data-submitting')).toBe('true');

    // B's own response now arrives — THIS is the active attempt, and it closes the shared form as normal.
    completeRepotDeferreds.B!.resolve({ ok: true, outcome: { status: 'applied' } });
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
    const doneButtons = byIcon(w, 'check');

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
    const doneButtons = byIcon(w, 'check');

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
    tasksFixture = repotTasks(null); // this test's subject is the evaluate/questionnaire flow
    const w = await mountPage();
    const evaluateButtons = byIcon(w, 'magnifying-glass');

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
    const doneButtons = byIcon(w, 'check');

    await doneButtons[0]!.trigger('click');
    await flushPromises();
    await w.find('.confirm-btn').trigger('click');
    await flushPromises();
    completeRepotDeferreds.A!.resolve({ ok: true, outcome: { status: 'applied' } });
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
    const doneButtons = byIcon(w, 'check');

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
    const doneButtons = byIcon(w, 'check');

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
    const doneButtons = byIcon(w, 'check');

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

    await byIcon(w, 'check')[0]!.trigger('click');
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
    tasksFixture = repotTasks(null); // this test's subject is the evaluate/questionnaire flow
    const w = await mountPage();
    const evaluateButtons = byIcon(w, 'magnifying-glass');

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
    tasksFixture = repotTasks(null); // this test's subject is the evaluate/questionnaire flow
    const w = await mountPage();
    const evaluateButtons = byIcon(w, 'magnifying-glass');

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
    // Task 2, step 4: the SAME icon-based hooks as the base `stubs.Button` above, so `doneButtons(w)` also
    // finds this describe's own Confirm button (and the real TaskRow's Done button, still mounted here too).
    Button: {
      props: ['disabled', 'icon', 'loading'],
      template: '<button class="stub-btn" :data-icon="icon" :disabled="disabled"><slot /></button>',
    },
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
    const doneButtons = byIcon(w, 'check');

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
    // This test's own subject is the evaluate/questionnaire flow (Task 2, step 3), so the fixture must
    // describe a plant awaiting the questionnaire — the RESOLVED default the rest of this file uses would
    // leave no evaluate affordance to click at all.
    const todaysTasksMock = vi.fn(async () => repotTasks(null));
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
    const evaluateButtons = byIcon(w, 'magnifying-glass');

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
    // This test's own subject is the Done-confirm flow (Task 2, step 3), so the fixture must describe a
    // plant with a RESOLVED verdict — the default shape the rest of this file uses, spelled out explicitly
    // here since this test overrides `useApi` wholesale for its own `todaysTasksMock` spy.
    const todaysTasksMock = vi.fn(async () => repotTasks(RESOLVED));
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
    const doneButtons = byIcon(w, 'check');

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
    completeRepotDeferreds.A!.resolve({ ok: true, outcome: { status: 'applied' } });
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
  // Task 2, step 5: `allowStandaloneDone` is a declared PROP of the real `TaskRow.vue` now, so it never falls
  // through to a `data-*` attribute the way it did on the deleted stub's own root div — the claim moves to the
  // behaviour the prop actually gates. Today never opts in (`pages/index.vue` omits `allow-standalone-done`
  // entirely), so a REPOT with no verdict shows the questionnaire ALONE: no standalone Done sits beside it.
  it('Today never offers a standalone Done — a REPOT with no verdict shows the questionnaire ALONE', async () => {
    tasksFixture = repotTasks(null);
    const w = await mountPage();
    expect(evaluateButtons(w).length).toBeGreaterThan(0); // a vacuous pass on zero rows proves nothing
    expect(doneButtons(w).length).toBe(0);
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
      // Evaluate-flow subject (Task 2, step 3): needs a plant awaiting the questionnaire.
      todaysTasks: async () => repotTasks(null),
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
    await byIcon(w, 'magnifying-glass')[0]!.trigger('click');
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
      // Evaluate-flow subject (Task 2, step 3): needs a plant awaiting the questionnaire.
      todaysTasks: async () => repotTasks(null),
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
    await byIcon(w, 'magnifying-glass')[0]!.trigger('click');
    await flushPromises();
    expect(w.find('.eval-modal').attributes('data-sign-ids')).toBe('A-s1,A-s2');
    // B's fetch FAILS: `evaluationPlantId` has already moved to B, and nothing updated the catalogue.
    await byIcon(w, 'magnifying-glass')[1]!.trigger('click');
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
// measured-verdict-gap spec (Task 47/T6b), REWORKED by QA finding F1 (2026-08-10) — the SAME row, whose
// survey has already ANSWERED today. `canSurveyWaterFor` gates on the VERDICT, not just the instrument and
// not on the bare `measuredToday` fact: asking again after the owner already got his answer is the exact
// dead end this closes.
//
// ⚠️ `measuredToday` IS DERIVED FROM THE VERDICT, never set beside it. The API derives it the same way, so
// a fixture that set the two independently could describe a payload the server cannot produce.
const answeredWaterTask = (todaysVerdict: TodaysVerdict) =>
  ({ ...WATER_TASK_A, measuredToday: todaysVerdict != null, todaysVerdict });
const WATER_TASK_A_MEASURED_TODAY = answeredWaterTask('WATER_NOW');

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
    sendFeedback: sendFeedbackMock,
  }));
}

describe('pages/index.vue — Plan 3 T5: the WATER row asks before it instructs, gated on canSurvey', () => {
  it('offers the survey on a WATER row when the owner has an instrument', async () => {
    getOwnerInstrumentsMock = vi.fn(async () => ({ available: [], selected: ['galvanic-probe'] }));
    stubApiWithWaterTask();

    const w = await mountPage();
    // ⚠️ REWRITTEN 2026-08-11 (QA round 4, DEF-3). The old line read "Done/Postpone stay withheld until the
    // survey answers", and the Postpone half of that was the defect: an owner who had selected an
    // instrument could not defer a watering AT ALL — the row offered "¿Necesitas regar?" and nothing else,
    // and his only escape was to switch his probe off in Settings. Hecho stays withheld, unchanged.
    // Task 2, step 5: `canSurvey` is a declared PROP of the real `TaskRow.vue` now, so it never falls through
    // to a `data-*` attribute — the claim moves to the behaviour the prop actually gates (the props are
    // pinned by the two new cases below and by `TaskRow.test.ts`).
    expect(evaluateButtons(w).length).toBe(1);
    expect(doneButtons(w).length).toBe(0);   // Hecho stays withheld — unchanged, DEF-3's kept half
    expect(postponeButtons(w).length).toBe(1); // Posponer is BACK — DEF-3 proper
  });

  // THE LOAD-BEARING CASE — an owner who selected no instrument has no way to satisfy a survey; the row
  // must stay byte-identical to today (Done AND Postpone, no survey), or he is locked out of marking a
  // watering done over a feature he declined.
  it('leaves the WATER row exactly as it is today when he has none', async () => {
    getOwnerInstrumentsMock = vi.fn(async () => ({ available: [], selected: [] as string[] }));
    stubApiWithWaterTask();

    const w = await mountPage();
    // The mirror of the case above (Task 2, step 5): no evaluate, Hecho and Posponer both back.
    expect(evaluateButtons(w).length).toBe(0);
    expect(doneButtons(w).length).toBe(1);
    expect(postponeButtons(w).length).toBe(1);
  });

  // measured-verdict-gap spec (Task 47/T6b) — the ground truth is the READING, not session memory: once
  // WATER_NOW has written today's reading, the row must fall back to the classic Done | Postpone pair,
  // exactly as an owner with no instrument sees, even though this owner DOES have one selected.
  it('withholds the survey once today\'s reading has answered the question, even with an instrument', async () => {
    getOwnerInstrumentsMock = vi.fn(async () => ({ available: [], selected: ['galvanic-probe'] }));
    stubApiWithWaterTask([WATER_TASK_A_MEASURED_TODAY]);

    const w = await mountPage();
    expect(evaluateButtons(w).length).toBe(0);
    expect(doneButtons(w).length).toBe(1);
    expect(postponeButtons(w).length).toBe(1);
  });

  it('opens the modal in SURVEY mode', async () => {
    getOwnerInstrumentsMock = vi.fn(async () => ({ available: [], selected: ['galvanic-probe'] }));
    stubApiWithWaterTask();

    const w = await mountPage();
    await byIcon(w, 'magnifying-glass')[0]!.trigger('click');
    await flushPromises();

    const modal = w.find('.soil-modal');
    expect(modal.attributes('data-open')).toBe('true');
    expect(modal.attributes('data-mode')).toBe('survey');
    expect(modal.attributes('data-plant-id')).toBe('A');
    // F1b's second door: the modal withholds **Hecho** on a pot already watered today, and Today supplies
    // that fact as the named constant `false` — a watering advances `nextDueOn`, so there is no Today card
    // left to open this from. Pinned rather than left to the comment: the day this payload does start
    // carrying the fact, this assertion is what says the constant was never replaced.
    expect(modal.attributes('data-watered-today')).toBe('false');
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
    await byIcon(w, 'magnifying-glass')[0]!.trigger('click');
    await flushPromises();

    const tasksReadsBeforeSave = todaysTasksMock.mock.calls.length;
    await w.find('.soil-save-btn').trigger('click');
    await flushPromises();

    expect(todaysTasksMock.mock.calls.length).toBeGreaterThan(tasksReadsBeforeSave);
  });
});

// FIX W1 — a FAILED instrument-catalogue fetch is NOT an empty catalogue. The old code caught the rejection
// and fell through with the empty shape, so the modal opened on "you haven't told us what you measure with
// yet, add an instrument in Settings" — a false statement for an owner whose `hasInstrument` gate is what
// offered the survey in the first place. And because `canSurveyWaterFor` never learned the fetch had
// failed, the row went on withholding Hecho AND Posponer: the owner went to Settings, saw his instruments,
// came back, and had no way to complete or postpone a due watering. A persistent fetch failure made the
// task unusable. The invariant (spec §5.2) is that nothing is withheld from an owner who cannot satisfy it.
describe('pages/index.vue — W1: a failed catalogue fetch must not lock the watering row', () => {
  it('does NOT open the modal, falls the row back to Hecho | Posponer, and says what actually happened',
    async () => {
      getOwnerInstrumentsMock = vi.fn(async () => ({ available: [], selected: ['galvanic-probe'] }));
      getSoilReadingsMock = vi.fn(async () => { throw new Error('network'); });
      stubApiWithWaterTask();

      const w = await mountPage();
      // Before the click the survey IS on offer — the owner owns an instrument. `canSurvey` is a declared
      // PROP of the real `TaskRow.vue` now (Task 2, step 5), so its only observable effect is the button it
      // gates — never a `data-*` attribute on the deleted stub's own root div.
      expect(evaluateButtons(w).length).toBe(1);

      await byIcon(w, 'magnifying-glass')[0]!.trigger('click');
      await flushPromises();

      // 1. The modal never opened on the empty state.
      expect(w.find('.soil-modal').attributes('data-open')).toBe('false');
      // 2. The row is actionable again: this is the half that made the task unusable.
      expect(evaluateButtons(w).length).toBe(0);
      expect(doneButtons(w).length).toBe(1);
      expect(postponeButtons(w).length).toBe(1);
      // 3. And the owner is told the truth — the load failed — never "you have no instruments".
      const banner = w.find('.repot-error-banner');
      expect(banner.exists()).toBe(true);
      expect(banner.attributes('data-description')).toBe('reading.surveyLoadError');
      expect(banner.attributes('data-description')).not.toBe('reading.noInstruments');
    });

  it('the banner\'s retry re-runs the fetch, and a success restores the survey', async () => {
    getOwnerInstrumentsMock = vi.fn(async () => ({ available: [], selected: ['galvanic-probe'] }));
    getSoilReadingsMock = vi.fn(async () => { throw new Error('network'); });
    stubApiWithWaterTask();

    const w = await mountPage();
    await byIcon(w, 'magnifying-glass')[0]!.trigger('click');
    await flushPromises();
    expect(w.find('.repot-error-banner').exists()).toBe(true);

    // The infrastructure recovers; the retry is the ONLY way back, since the row's own survey button is
    // gone by design.
    getSoilReadingsMock.mockImplementation(async () => (
      { instruments: [{ id: 'galvanic-probe' }], protocol: null, readings: [], wateringDays: [] }
    ));
    await w.find('.retry-btn').trigger('click');
    await flushPromises();

    expect(w.find('.soil-modal').attributes('data-open')).toBe('true');
    expect(w.find('.soil-modal').attributes('data-mode')).toBe('survey');
    expect(evaluateButtons(w).length).toBe(1);
    expect(w.find('.repot-error-banner').exists()).toBe(false);
  });
});

// FIX W2 — spec §5.4 ("Postpone stops asking the owner for a reason. After a survey there is nothing to
// ask: either the soil said wait, or the owner ran out of day. The reason picker remains only on the
// un-gated (no-instrument) row.") was never implemented: `onPostpone` opened the generic picker for EVERY
// WATER postpone. Beyond the wasted tap, that picker still offers `soil-still-moist`, which MOVES the
// watering cadence — so an owner who measured WATER_NOW and then ran out of day could feed the adaptation
// loop a wet-soil signal his own measurement, taken minutes earlier, contradicts.
describe('pages/index.vue — W2: a postpone after today\'s measurement sends no-time without asking', () => {
  it('submits `no-time` directly and never opens the picker', async () => {
    getOwnerInstrumentsMock = vi.fn(async () => ({ available: [], selected: ['galvanic-probe'] }));
    stubApiWithWaterTask([WATER_TASK_A_MEASURED_TODAY]);

    const w = await mountPage();
    // Today's reading already answered, so the row is back to its ordinary pair — the Posponer under test.
    await byIcon(w, 'clock')[0]!.trigger('click');
    await flushPromises();

    expect(sendFeedbackMock).toHaveBeenCalledTimes(1);
    expect(sendFeedbackMock.mock.calls[0][0]).toBe('A');
    expect(sendFeedbackMock.mock.calls[0][1]).toMatchObject({
      task: 'WATER', type: 'POSTPONED', reason: 'no-time',
    });
    // Neither picker (early-water, postpone) was ever shown.
    expect(w.findAll('.reason-picker').map((p) => p.attributes('data-open'))).toEqual(['false', 'false']);
  });

  it('still asks on the un-measured row — that reason is the only signal the engine has there', async () => {
    getOwnerInstrumentsMock = vi.fn(async () => ({ available: [], selected: [] as string[] }));
    stubApiWithWaterTask();

    const w = await mountPage();
    await byIcon(w, 'clock')[0]!.trigger('click');
    await flushPromises();

    expect(sendFeedbackMock).not.toHaveBeenCalled();
    // The SECOND picker is the postpone one (template order: early-water first).
    expect(w.findAll('.reason-picker')[1].attributes('data-open')).toBe('true');
  });

  // The rule is WATER's alone: no other task carries a feedback reason at all, so a measured flag must
  // never leak a reason onto a REPOT postpone (which sends its own fixed inspection reason via a different
  // path entirely).
  it('leaves a REPOT postpone on its own path', async () => {
    getOwnerInstrumentsMock = vi.fn(async () => ({ available: [], selected: ['galvanic-probe'] }));
    stubApiWithWaterTask([
      { plantId: 'A', task: 'REPOT' as const, nextDueOn: '2026-01-01',
        pendingEvaluation: { evaluationId: 'ev-A', verdict: 'REPOT', reevaluateOn: null } },
    ]);

    const w = await mountPage();
    await byIcon(w, 'clock')[0]!.trigger('click');
    await flushPromises();

    expect(sendFeedbackMock).toHaveBeenCalledTimes(1);
    expect(sendFeedbackMock.mock.calls[0][1].task).toBe('REPOT');
    expect(sendFeedbackMock.mock.calls[0][1].reason).not.toBe('no-time');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════
// QA 2026-08-11, finding 3 — THE WIRING HALF on Today (owner-ruled; docs/care-engine.md §7.20.15).
//
// The rule lives in `utils/waterSurvey.ts` and the badge/Posponer half is pinned in TaskRow.test.ts. What
// only THIS file can pin is that the page applies the same rule to the status it hands `onDone` — because
// that status is what decides whether the early-watering reason picker opens. Applying the override to the
// badge alone would have the app tell the owner to water now and then ask him, one tap later, why he is
// watering early: second-guessing its own verdict, and offering him `soil-still-moist`, a reason that MOVES
// the watering cadence against the measurement he just took.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════
describe('pages/index.vue — finding 3: a measured WATER_NOW is acted on as a task due today', () => {
  // A watering the calendar puts well in the future — the case the whole finding is about. (Every other
  // WATER fixture in this file is long overdue, which is why none of them could have caught this.)
  const FUTURE_WATER = { plantId: 'A', task: 'WATER' as const, nextDueOn: '2099-01-01', pendingEvaluation: null };

  it('sends the Done straight through — no "why are you watering early?" after its own verdict', async () => {
    getOwnerInstrumentsMock = vi.fn(async () => ({ available: [], selected: ['galvanic-probe'] }));
    stubApiWithWaterTask([{ ...FUTURE_WATER, measuredToday: true, todaysVerdict: 'WATER_NOW' }]);

    const w = await mountPage();
    // The verdict closed the survey affordance, so the ordinary pair is what is on the card. `todaysVerdict`
    // is a declared PROP of the real `TaskRow.vue` now (Task 2, step 5) — its only observable effect is the
    // affordance it closes, never a `data-*` attribute on the deleted stub's own root div.
    expect(evaluateButtons(w).length).toBe(0);
    await byIcon(w, 'check')[0]!.trigger('click');
    await flushPromises();

    expect(sendFeedbackMock).toHaveBeenCalledTimes(1);
    expect(sendFeedbackMock.mock.calls[0][1]).toMatchObject({ task: 'WATER', type: 'DONE' });
    // Neither picker was shown (template order: early-water first, postpone second).
    expect(w.findAll('.reason-picker').map((p) => p.attributes('data-open'))).toEqual(['false', 'false']);
  });

  // THE BEFORE HALF, and without it the case above would pass just as well against a page that never asked
  // the early-watering question at all — which would be a different regression, silently deleting the one
  // signal the engine has about an unmeasured early watering.
  it('still asks on a future-dated watering that was NOT measured today', async () => {
    getOwnerInstrumentsMock = vi.fn(async () => ({ available: [], selected: [] as string[] }));
    stubApiWithWaterTask([{ ...FUTURE_WATER, measuredToday: false, todaysVerdict: null }]);

    const w = await mountPage();
    await byIcon(w, 'check')[0]!.trigger('click');
    await flushPromises();

    expect(sendFeedbackMock).not.toHaveBeenCalled();
    expect(w.findAll('.reason-picker')[0].attributes('data-open')).toBe('true');
  });
});

describe('pages/index.vue — row order within a card, card order untouched (spec §2.2)', () => {
  it('orders each card REPOT > WATER > FERTILIZE without moving the PLANTS', async () => {
    // Plant B leads the API's list (its watering is the most overdue). Its REPOT is last in the payload
    // and must rise to the top of ITS OWN card — while B itself stays the first card on the page.
    tasksFixture = [
      { plantId: 'B', task: 'WATER', nextDueOn: '2026-01-01', pendingEvaluation: null },
      { plantId: 'A', task: 'FERTILIZE', nextDueOn: '2026-02-01', pendingEvaluation: null },
      { plantId: 'B', task: 'REPOT', nextDueOn: '2028-01-01', pendingEvaluation: RESOLVED },
      { plantId: 'A', task: 'WATER', nextDueOn: '2026-02-01', pendingEvaluation: null },
    ] as any;
    const w = await mountPage();
    const cards = w.findAll('.mp-taskrow__label');
    // Rendered document order = card order then row order.
    expect(cards.map((l) => l.text())).toEqual(['REPOT', 'WATER', 'WATER', 'FERTILIZE']);
  });
});

// Task 10 — Today's rows carry no date box, so every submit it produces takes the SAME-DAY path
// (`doneSubmitPath` returns 'same-day' by construction here). Today can never exercise the back-dated half
// of `careOutcomeNoteKey`'s FERTILIZE split — that half is PlantDetail.test.ts's, whose rows do carry one.
describe('pages/index.vue — Task 10: the one-per-day outcome reaches the row', () => {
  it('warns on a same-day FERTILIZE the server already had, with the IMPERATIVE sentence', async () => {
    tasksFixture = [{ plantId: 'A', task: 'FERTILIZE', nextDueOn: '2026-01-01', pendingEvaluation: null }] as any;
    sendFeedbackMock = vi.fn(async () => ({
      ok: true,
      outcome: {
        status: 'already-recorded-on-day', task: 'FERTILIZE', occurredOn: todayYmd(),
        otherEffectsApplied: false,
      },
    }));
    const w = await mountPage();
    await doneButtons(w)[0]!.trigger('click');
    await flushPromises();
    expect(w.find('.mp-taskrow__outcome-note').text()).toBe('tasks.alreadyRecorded.fertilizeSameDay');
  });

  // The twin of `PlantDetail.test.ts`'s own outcome-less case, pinned separately because the two pages
  // carry PARALLEL copies of `recordOutcome`. An API that predates the outcome answers `{ ok: true }` and
  // nothing else — the absence `careOutcomeNoteKey` already accepts by design ("say nothing"). Reading
  // `.status` off it throws inside `sendDone`, BEFORE `await refresh()`, so the card never reconciles and
  // the press reads as a dead button over a write the server actually performed. The refresh is the
  // assertion: the note is absent either way, so only the refresh separates a survived press from a
  // thrown one.
  it('still refreshes Today when the server sent no outcome at all (an older API mid rolling deploy)', async () => {
    tasksFixture = [{ plantId: 'A', task: 'FERTILIZE', nextDueOn: '2026-01-01', pendingEvaluation: null }] as any;
    sendFeedbackMock = vi.fn(async () => ({ ok: true }));
    const refreshTasks = vi.fn(async () => {});
    vi.stubGlobal('useAsyncData', async (key: string, fn: () => Promise<unknown>) => ({
      data: ref(await fn()),
      refresh: key === 'today' ? refreshTasks : vi.fn(async () => {}),
    }));
    const w = await mountPage();
    await doneButtons(w)[0]!.trigger('click');
    await flushPromises();
    expect(refreshTasks).toHaveBeenCalled();
    expect(w.find('.mp-taskrow__outcome-note').exists()).toBe(false);
  });

  // Level-integration finding: `onRepotDoneConfirm` (the Done-form confirm path, distinct from `sendDone`
  // above — REPOT's Done detours through `UiRepotDoneForm` rather than firing straight off the row) awaited
  // `api.completeRepot(...)` and threw the result away, so a REPOT completion rendered as if nothing had
  // happened even though the server reported an `already-recorded-on-day` outcome. Mirrors
  // `PlantDetail.test.ts`'s own WATER/FERTILIZE outcome-note cases in the same "Task 10" family, applied to
  // REPOT's own confirm flow — same real `TaskRow.vue`, same `.mp-taskrow__outcome-note` assertion, so both
  // renderers are held to the identical standard.
  //
  // `otherEffectsApplied` is pinned `false` here, matching every other fixture in this codebase
  // (`utils/careOutcome.test.ts` says explicitly why): this case only needs to prove that Today's REPOT
  // completion populates the outcome note AT ALL — the defect was that nothing rendered, not that the wrong
  // sentence rendered. The `true` case (F2 fix) is its OWN case immediately below, asserting the NEW key.
  it('a REPOT completion via the Done form populates the outcome note, mirroring PlantDetail.vue', async () => {
    tasksFixture = repotTasks(RESOLVED); // a Done button is only offered once a REPOT verdict is pending
    const w = await mountPage();
    await doneButtons(w)[0]!.trigger('click');
    await flushPromises();
    await w.find('.confirm-btn').trigger('click');
    await flushPromises();
    completeRepotDeferreds.A!.resolve({
      ok: true,
      outcome: {
        status: 'already-recorded-on-day', task: 'REPOT', occurredOn: todayYmd(),
        otherEffectsApplied: false,
      },
    });
    await flushPromises();
    expect(w.find('.mp-taskrow__outcome-note').text()).toBe('tasks.alreadyRecorded.neutral');
  });

  // F2 fix: on a duplicate REPOT the server still runs the profile write, the substrate refresh and the
  // recompute — only the CareEvent row is suppressed. The neutral "nothing was added" sentence above is
  // exactly the phrasing PIN 1 (`docs/superpowers/specs/2026-08-14-nothing-left-open-design.md` §3.2)
  // forbids for this case, so an `otherEffectsApplied: true` outcome must render the DIFFERENT key.
  it('a REPOT completion whose otherEffectsApplied is true gets the effects-applied sentence, never the neutral one', async () => {
    tasksFixture = repotTasks(RESOLVED);
    const w = await mountPage();
    await doneButtons(w)[0]!.trigger('click');
    await flushPromises();
    await w.find('.confirm-btn').trigger('click');
    await flushPromises();
    completeRepotDeferreds.A!.resolve({
      ok: true,
      outcome: {
        status: 'already-recorded-on-day', task: 'REPOT', occurredOn: todayYmd(),
        otherEffectsApplied: true,
      },
    });
    await flushPromises();
    const note = w.find('.mp-taskrow__outcome-note').text();
    expect(note).toBe('tasks.alreadyRecorded.otherEffectsApplied');
    expect(note).not.toBe('tasks.alreadyRecorded.neutral');
  });

  // F11 fix: the outcome note must resolve through i18n at RENDER time, never freeze in the locale that
  // was active when the owner submitted. The module-level `useI18n` stub's `t` is an identity function
  // (`k => k`), which can't tell "resolved at write time" from "resolved at render time" apart — both would
  // read the same key either way — so THIS test overrides `useI18n` with a genuinely locale-aware `t`, then
  // switches `locale` AFTER the submit WITHOUT remounting. A stale-string bug (storing `t(key)` instead of
  // `key`) would leave the note on its English text even after the switch.
  it('a locale switch AFTER the submit re-renders the outcome note in the new locale', async () => {
    const NOTE_KEY = 'tasks.alreadyRecorded.neutral';
    const localeRef = ref<'en' | 'es'>('en');
    const localizedT = (k: string) => {
      if (k !== NOTE_KEY) return k;
      return localeRef.value === 'es' ? 'ES: sin cambios' : 'EN: nothing added';
    };
    vi.stubGlobal('useI18n', () => ({ t: localizedT, d: () => '', locale: localeRef }));
    try {
      tasksFixture = [{ plantId: 'A', task: 'ROTATE', nextDueOn: '2026-01-01', pendingEvaluation: null }] as any;
      sendFeedbackMock = vi.fn(async () => ({
        ok: true,
        outcome: {
          status: 'already-recorded-on-day', task: 'ROTATE', occurredOn: todayYmd(),
          otherEffectsApplied: false,
        },
      }));
      const w = await mountPage();
      await doneButtons(w)[0]!.trigger('click');
      await flushPromises();
      expect(w.find('.mp-taskrow__outcome-note').text()).toBe('EN: nothing added');

      localeRef.value = 'es';
      await flushPromises();
      expect(w.find('.mp-taskrow__outcome-note').text()).toBe('ES: sin cambios');
    } finally {
      vi.stubGlobal('useI18n', () => ({ t: (k: string) => k, d: () => '', locale: ref('en') }));
    }
  });
});

// AF-1 (code review, adversarial pass) — `today` used to be `const today = todayYmd();`, evaluated ONCE at
// setup, so a tab left open across local midnight kept sending the OLD day in every DONE/POSTPONE payload
// that falls back to it — precisely the dedup's own key (B2's one-per-day rule). The fix makes `today` a
// FUNCTION, re-read at every call site, byte-for-byte the shape PlantDetail.vue's twin already used
// (`const today = () => todayYmd();`). This block proves the mechanism: mount the page BEFORE midnight, roll
// the fake clock PAST it, THEN submit — and assert the request PAYLOAD carries the NEW day, never the day
// the tab happened to load on. Asserting the payload (not the response, not the rendered note) is the
// project's own lesson (`docs/retax-skills/findings/...`: "asserting the payload per branch — rather than
// the response — is a lesson this workspace has already paid for").
describe('pages/index.vue — AF-1: `today` is read LIVE at submit time, never frozen at page setup', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('a DONE sent after the tab crossed local midnight carries the NEW day, not the day the page loaded on', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 0, 1, 23, 59, 50)); // Jan 1, 23:59:50 local — the page mounts here

    tasksFixture = [{ plantId: 'A', task: 'FERTILIZE', nextDueOn: '2026-01-01', pendingEvaluation: null }] as any;
    const w = await mountPage();

    // The clock rolls over past midnight while the tab sits open, unattended.
    vi.setSystemTime(new Date(2026, 0, 2, 0, 0, 5)); // Jan 2, 00:00:05 local

    await doneButtons(w)[0]!.trigger('click');
    await flushPromises();

    expect(sendFeedbackMock).toHaveBeenCalledTimes(1);
    // With the frozen module-level constant this reads '2026-01-01' — the day the page happened to load on.
    expect(sendFeedbackMock.mock.calls[0]![1]).toMatchObject({ task: 'FERTILIZE', occurredOn: '2026-01-02' });
  });

  it('a POSTPONE sent after the tab crossed local midnight sends the NEW day for BOTH occurredOn and postponeToOn', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 0, 1, 23, 59, 50)); // Jan 1, 23:59:50 local — the page mounts here

    tasksFixture = [{ plantId: 'A', task: 'FERTILIZE', nextDueOn: '2026-01-01', pendingEvaluation: null }] as any;
    const w = await mountPage();

    // The clock rolls over past midnight while the tab sits open, unattended.
    vi.setSystemTime(new Date(2026, 0, 2, 0, 0, 5)); // Jan 2, 00:00:05 local

    await postponeButtons(w)[0]!.trigger('click');
    await flushPromises();

    expect(sendFeedbackMock).toHaveBeenCalledTimes(1);
    const body = sendFeedbackMock.mock.calls[0]![1];
    // occurredOn must name the postpone's own day (Jan 2) — with the frozen constant this reads '2026-01-01'.
    expect(body).toMatchObject({ task: 'FERTILIZE', type: 'POSTPONED', occurredOn: '2026-01-02' });
    // And postponeToOn (addDaysYmd(1), always a LIVE read) must land exactly one day after — never two days
    // ahead of a stale occurredOn, which is the "frozen occurredOn + live addDaysYmd" gap AF-1 also named.
    expect(body.postponeToOn).toBe('2026-01-03');
  });
});

// AF-23 (code review, adversarial pass) — the outcome note is rendered as a PROP on the `UiTaskRow` that
// produced it, inside the `v-for` over the live due-today list. For an `already-recorded-on-day` outcome
// the task was, by definition, already recorded that day, so the row's `nextDueOn` had ALREADY advanced
// out of "due today" on the FIRST successful completion — meaning `GET /care-plan/today`'s very next fetch
// (the `refresh()` every submission triggers) omits the row. `outcomeNotes` (the STATE) survives; the row
// that RENDERS it does not. Every other test in this file mocks `todaysTasks` as a constant, so the row
// always comes back after `refresh()` and this defect is structurally invisible to them — this is the one
// test in the file whose `todaysTasks` mock genuinely differs between the pre-submit and post-submit read.
describe('pages/index.vue — AF-23: an outcome note survives the refresh that removes its own row', () => {
  it('keeps the note visible in a page-level notice once the row is gone from the post-submit refresh', async () => {
    const todaysTasksMock = vi.fn()
      .mockResolvedValueOnce([{ plantId: 'A', task: 'FERTILIZE', nextDueOn: '2026-01-01', pendingEvaluation: null }])
      // The refresh that follows the submit: the FERTILIZE row has moved out of "due today".
      .mockResolvedValueOnce([]);
    // Unlike the file's DEFAULT `useAsyncData` stub (a no-op `refresh`), this one genuinely re-invokes
    // `fn` — the same technique the pre-existing "reconciles Today through the existing refresh() seam"
    // case above uses — because THIS test's whole point is what happens once the refresh actually lands.
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
      sendFeedback: vi.fn(async () => ({
        ok: true,
        outcome: {
          status: 'already-recorded-on-day', task: 'FERTILIZE', occurredOn: todayYmd(),
          otherEffectsApplied: false,
        },
      })),
    }));

    const w = await mountPage();
    expect(doneButtons(w).length).toBe(1);
    await doneButtons(w)[0]!.trigger('click');
    await flushPromises();

    // The row itself is genuinely gone — the refresh removed it, exactly as production does.
    expect(doneButtons(w).length).toBe(0);
    expect(w.find('.mp-taskrow__outcome-note').exists()).toBe(false);
    // But the note survives, in the page-level notice — the sentence owner decision 9 promises is not
    // silently withdrawn the instant the list catches up.
    expect(w.find('.mp-today__standalone-note').text()).toContain('tasks.alreadyRecorded.fertilizeSameDay');
  });
});

// V4 fix (code review) — `dismissStandaloneOutcomeNote` used to remove the note ONLY from
// `standaloneOutcomeNotes`, leaving its source entries sitting in `outcomeNotes`/`anchorKeptDays` (which
// are only ever spread-OVERWRITTEN, never deleted from, by `recordOutcome`). The NEXT completion —
// anywhere on the page, not necessarily the same plant/task — runs `reconcileOutcomeNotesAfterRefresh()`
// again, which rebuilds its candidate set from exactly those two maps; finding the dismissed key still
// there and no longer in `standaloneOutcomeNotes`' own `keptKeys`, it silently RE-PROMOTES the note the
// owner already closed. There was previously no test in this file that even clicked the dismiss button.
describe('pages/index.vue — V4: a dismissed standalone note must not resurrect on a later completion', () => {
  it('stays gone after dismiss, even once an UNRELATED later completion runs the same reconcile function', async () => {
    const todaysTasksMock = vi.fn()
      .mockResolvedValueOnce([
        { plantId: 'A', task: 'FERTILIZE', nextDueOn: '2026-01-01', pendingEvaluation: null },
        { plantId: 'B', task: 'ROTATE', nextDueOn: '2026-01-01', pendingEvaluation: null },
      ])
      // After A's FERTILIZE completes: A's row is gone (already recorded that day); B's ROTATE stays due.
      .mockResolvedValueOnce([{ plantId: 'B', task: 'ROTATE', nextDueOn: '2026-01-01', pendingEvaluation: null }])
      // After B's ROTATE completes: irrelevant to this test's assertions.
      .mockResolvedValue([]);
    vi.stubGlobal('useAsyncData', async (_key: string, fn: () => Promise<unknown>) => {
      const data = ref(await fn());
      return { data, refresh: vi.fn(async () => { data.value = await fn(); }) };
    });
    // A's FERTILIZE is a duplicate (produces the standalone note); B's ROTATE is an ordinary APPLIED write
    // (produces no note of its own) — so any note seen after B's completion can only be A's, resurrected.
    const sendFeedback = vi.fn(async (_plantId: string, body: { task: string }) => (
      body.task === 'FERTILIZE'
        ? {
          ok: true,
          outcome: {
            status: 'already-recorded-on-day', task: 'FERTILIZE', occurredOn: todayYmd(),
            otherEffectsApplied: false,
          },
        }
        : { ok: true, outcome: { status: 'applied' } }
    ));
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
      sendFeedback,
    }));

    const w = await mountPage();
    expect(doneButtons(w).length).toBe(2);

    // Complete A's FERTILIZE — its row is gone after the refresh, and the note is promoted to standalone.
    await doneButtons(w)[0]!.trigger('click');
    await flushPromises();
    expect(w.find('.mp-today__standalone-note').text()).toContain('tasks.alreadyRecorded.fertilizeSameDay');

    // The owner dismisses it.
    await w.find('.mp-today__standalone-note-dismiss').trigger('click');
    await flushPromises();
    expect(w.find('.mp-today__standalone-note').exists()).toBe(false);

    // A LATER, UNRELATED completion (B's ROTATE) drives the SAME reconcile function again.
    expect(doneButtons(w).length).toBe(1);
    await doneButtons(w)[0]!.trigger('click');
    await flushPromises();

    // The dismissed note must stay gone — running the reconcile function again must never resurrect it.
    expect(w.find('.mp-today__standalone-note').exists()).toBe(false);
  });
});

// ---- THE SUBSTRATE CLOCK REFUSED TO MOVE (owner ruling, 2026-08-14; API finding E8) -------------------
//
// A repot completion dated strictly BEFORE the plant's stored substrate anchor is recorded as an event but
// leaves the clock — and every calibrated reading depending on it — alone. That refusal travels as a
// SECOND, independent outcome (`substrate`), and Today has to say it.
//
// The AF-23 promotion above is not an optional extra here: the case where the clock refuses to move is a
// DUPLICATE repot naming an older day, and a duplicate is precisely the row that is gone by the next fetch.
// So the standalone notice is the surface the owner actually reads this sentence on, every time.
describe('pages/index.vue — the substrate anchor stayed, and Today says so', () => {
  // V8 fix (code review) — the module-level `useI18n` stub's `d: () => ''` returns the SAME constant no
  // matter what it is handed, so both tests below stayed green through three distinct regressions: the
  // interpolation being dropped entirely, a raw (unformatted) ISO string reaching `$t`, or the SUBMITTED
  // day (`occurredOn`, `todayYmd()`) reaching the sentence instead of the surviving anchor
  // (`refreshedOn`, `'2026-08-11'` below — deliberately a different day from `todayYmd()`, so confusing
  // the two is detectable at all). `d: (v) => String(v)` echoes its input back — the SAME technique
  // `PlantDetail.test.ts` uses — so the rendered text now carries a value that traces back to exactly
  // which day was passed in, and `t` appends the named params it was called with (mirroring every other
  // param-observing `$t`/`t` mock already in this codebase) so the interpolation itself can't be silently
  // dropped either.
  const localizedT = (k: string, named?: Record<string, unknown>) =>
    (named ? `${k}|${JSON.stringify(named)}` : k);
  const DEFAULT_USE_I18N = () => ({ t: (k: string) => k, d: () => '', locale: ref('en') });
  function expectAnchorSentence(text: string) {
    expect(text).toContain(
      `tasks.substrateAnchorKept|${JSON.stringify({ date: String(ymdToLocalDate('2026-08-11')) })}`,
    );
  }

  it('renders the anchor-kept sentence on the row, alongside the already-recorded one', async () => {
    vi.stubGlobal('useI18n', () => ({ t: localizedT, d: (v: unknown) => String(v), locale: ref('en') }));
    try {
      tasksFixture = repotTasks(RESOLVED);
      const w = await mountPage();
      await doneButtons(w)[0]!.trigger('click');
      await flushPromises();
      await w.find('.confirm-btn').trigger('click');
      await flushPromises();
      completeRepotDeferreds.A!.resolve({
        ok: true,
        outcome: {
          status: 'already-recorded-on-day', task: 'REPOT', occurredOn: todayYmd(),
          // `otherEffectsApplied: false` — NOT `true` (corrected, adversarial review, 2026-08-14). The two
          // fields are not independent: `repot-complete.write-core.ts` computes `otherEffectsApplied` as
          // `!substrateWillBeRefused`, and `substrate: kept` (below) is returned exactly when the anchor
          // comparison is `older`, i.e. exactly when the anchor WILL be refused. A `kept` anchor paired with
          // `otherEffectsApplied: true` is a state the real server can never produce; the old pairing here
          // quietly exercised the DEAD `.otherEffectsApplied` branch while the LIVE `.neutral` + anchor-kept
          // pairing went uncovered on this surface.
          otherEffectsApplied: false,
        },
        substrate: { status: 'kept', refreshedOn: '2026-08-11' },
      });
      await flushPromises();
      const note = w.find('.mp-taskrow__outcome-note').text();
      // BOTH facts, never one instead of the other, and the SURVIVING anchor's own date — never the
      // submitted `occurredOn` (`todayYmd()`), which this fixture deliberately sets to a different day.
      expect(note).toContain('tasks.alreadyRecorded.neutral');
      expectAnchorSentence(note);
    } finally {
      vi.stubGlobal('useI18n', DEFAULT_USE_I18N);
    }
  });

  it('promotes the anchor sentence into the page-level notice when the row is gone after the refresh', async () => {
    vi.stubGlobal('useI18n', () => ({ t: localizedT, d: (v: unknown) => String(v), locale: ref('en') }));
    try {
      tasksFixture = repotTasks(RESOLVED);
      const todaysTasksMock = vi.fn()
        .mockResolvedValueOnce(repotTasks(RESOLVED))
        // The refresh that follows the completion: the REPOT row has moved out of "due today".
        .mockResolvedValueOnce([]);
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
        getOwnerInstruments: getOwnerInstrumentsMock,
        getSoilReadings: getSoilReadingsMock,
        sendFeedback: vi.fn(),
        // Resolved immediately — this case is about what survives the refresh, not about the in-flight race
        // the deferred harness above exists for.
        completeRepot: vi.fn(async () => ({
          ok: true,
          outcome: {
            status: 'already-recorded-on-day', task: 'REPOT', occurredOn: todayYmd(),
            // `otherEffectsApplied: false` — see the sibling test above for why `true` paired with a `kept`
            // anchor is a state the real server can never produce (corrected, adversarial review, 2026-08-14).
            otherEffectsApplied: false,
          },
          substrate: { status: 'kept', refreshedOn: '2026-08-11' },
        })),
      }));

      const w = await mountPage();
      await doneButtons(w)[0]!.trigger('click');
      await flushPromises();
      await w.find('.confirm-btn').trigger('click');
      await flushPromises();

      // The row is genuinely gone — the same shape AF-23 pins.
      expect(w.find('.mp-taskrow__outcome-note').exists()).toBe(false);
      const standalone = w.find('.mp-today__standalone-note').text();
      // The SURVIVING anchor's own date — never the submitted `occurredOn`.
      expectAnchorSentence(standalone);
      // POSITIVE CONTROL: the other half was promoted too, so this is a note carrying BOTH sentences rather
      // than a promotion that happened to drop one of them.
      expect(standalone).toContain('tasks.alreadyRecorded.neutral');
    } finally {
      vi.stubGlobal('useI18n', DEFAULT_USE_I18N);
    }
  });
});
