// @vitest-environment happy-dom
//
// Lifecycle-action gating + wiring (Plant Lifecycle feature, Task 30). PlantDetail.vue is the ONE shared
// detail body /plants/:id, /pantheon/:id and /gifted/:id all render (Task 28), so this is also the only
// place the memorialize/gift/revive actions can regress. This file pins:
//   - memorialize + gift render ONLY for an ACTIVE plant;
//   - revive renders ONLY for a GIFTED plant;
//   - MEMORIAL (terminal, per spec) renders NEITHER — there is no way back from the pantheon;
//   - the pantheon confirmation copy explicitly states the transition is PERMANENT (real vue-i18n
//     messages are used here, not a mocked passthrough `t`, so this assertion is on the ACTUAL user-facing
//     string, not just a key name);
//   - each confirmed action calls the right useApi method with the right arguments and then navigates to
//     the right section;
//   - revive's confirm stays disabled until a place is chosen.
//
// `ref`/`computed`/`watch` are Vue's own reactivity primitives, normally auto-imported by Nuxt's build
// pipeline — outside it (plain vitest + @vue/test-utils, no auto-import shim) they don't exist as globals,
// same technique ProgressForm.test.ts / NoteModal.test.ts / pages/plants/{new,index}.test.ts use.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ref, computed, watch, defineComponent } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import en from '../i18n/locales/en.json';
import es from '../i18n/locales/es.json';
// W1 moved the two REPOT-attempt stores (`'evaluation'` / `'done'`) to MODULE scope, so — unlike the
// per-component-instance Maps this file's REPOT describe blocks used to exercise — they now persist across
// every `it()` in THIS file. Every REPOT test here mounts the SAME plant id ('p1'), so without an explicit
// reset a key/body left outstanding by one describe block (e.g. B1's deliberately-frozen Done attempt) is
// still sitting in the store when the NEXT describe block (e.g. U2) mounts a fresh PlantDetail and opens
// the Done form for 'p1' again — read as a resume it never asked for, with a STALE stored envelope.
import { __resetRepotAttemptStoresForTests } from '../composables/useRepotAttempt';
// Task 28 — several `UiRepotDoneForm` stubs below mimic the REAL component's own default (`seedOccurredOn
// || todayYmd()`, see components/ui/RepotDoneForm.vue), never a second ad-hoc "today" computation of their
// own (the project's "no new forks" rule).
import { todayYmd } from '../utils/localDate.js';
import type { TodaysVerdict } from '../utils/waterSurvey.js';
// The REAL row (spec §5.1) — imported directly and swapped in as the `UiTaskRow` stub value for the five
// REPOT-attempt describes below, exactly like `pages/index.test.ts`'s identical technique (Task 2). Neither
// `pages/index.vue` nor `PlantDetail.vue` imports `UiTaskRow` itself (it resolves via Nuxt's directory-based
// auto-import in production), so under plain vitest — no Nuxt build pipeline — the tag has nothing to
// resolve to on its own; `@vue/test-utils` registers whatever `stubs.UiTaskRow` names as the component that
// tag renders, real or fake. Passing the real import there is what makes the row genuinely mount.
import TaskRow from './ui/TaskRow.vue';

const i18n = createI18n({ legacy: false, locale: 'en', fallbackLocale: 'en', messages: { en, es } }).global;

vi.stubGlobal('ref', ref);
vi.stubGlobal('computed', computed);
vi.stubGlobal('watch', watch);
vi.stubGlobal('useI18n', () => ({ t: i18n.t, d: (v: unknown) => String(v), locale: ref('en') }));
vi.stubGlobal('useHead', () => {});
vi.stubGlobal('useSeoMeta', () => {});
vi.stubGlobal('useIsDesktop', () => ref(true));
vi.stubGlobal('useTaskMeta', () => ({ dueLabelLong: () => '', healthLabel: () => '' }));
// The real `TaskRow.vue` is mounted in this file now (spec §5.1), and it imports `useTaskMeta` through an
// EXPLICIT `~/composables/useTaskMeta` path — `vi.stubGlobal` only intercepts a global reference, never an
// import statement, so the module itself has to be mocked. Same technique `pages/index.test.ts` (Task 2)
// and `TaskRow.test.ts` use. `PlantDetail.vue` itself keeps reading `dueLabelLong`/`healthLabel` off the
// `vi.stubGlobal('useTaskMeta', …)` above (it calls the auto-imported global, not this explicit path).
vi.mock('~/composables/useTaskMeta', () => ({
  useTaskMeta: () => ({
    TASK_ICONS: {
      WATER: 'droplet', FERTILIZE: 'beaker', REPOT: 'magnifying-glass',
      ROTATE: 'arrow-path', CLEAN_LEAVES: 'sparkles', MIST: 'cloud', PROGRESS: 'camera',
    },
    taskLabel: (t: string) => t,
    dueLabelLong: () => 'Today',
    healthLabel: () => '',
  }),
}));
vi.stubGlobal('useFeedbackReasons', () => ({
  earlyWaterOptions: computed(() => []),
  postponeOptions: computed(() => []),
  repotPostponeOptions: computed(() => []),
}));
vi.stubGlobal('useProfileMeta', () => ({
  windowDistanceLabel: () => null,
  potTypeLabel: () => null,
  soilMixLabel: () => null,
  growthHabitLabel: () => null,
}));
// QA finding F3 (2026-08-10) — the survey's "calíbrala" link arrives as `?calibrate=1`, and PlantDetail
// opens the calibration modal on it and then strips the flag. Both halves are stubbed here, per-test
// mutable, so the calibration block below can drive an arrival and assert the strip.
let routeQuery: Record<string, string> = {};
const routerReplaceMock = vi.fn(async (_to: { path: string; query: Record<string, string> }) => {});
vi.stubGlobal('useRoute', () => ({ path: '/plants/p1', query: routeQuery }));
vi.stubGlobal('useRouter', () => ({ replace: routerReplaceMock }));

const navigateToMock = vi.fn(async () => {});
vi.stubGlobal('navigateTo', navigateToMock);

// Faithful enough for this component: it `await`s the fetcher and reads `.data`/`.refresh` — same
// technique pages/plants/{new,index}.test.ts use for the essential (non-deferred) reads.
vi.stubGlobal('useAsyncData', async (_key: string, fn: () => Promise<unknown>) => ({
  data: ref(await fn()),
  refresh: vi.fn(async () => {}),
}));
// The deferred (`{ server: false }`) reads: start null, populate once the fetch resolves — mirrors
// pages/plants/index.test.ts's stub for the same composable.
vi.stubGlobal('useLazyAsyncData', (_key: string, fn: () => Promise<unknown>) => {
  const data = ref<unknown>(null);
  void Promise.resolve(fn()).then((v) => { data.value = v; });
  return { data, refresh: vi.fn(async () => {}) };
});

function basePlant(overrides: Record<string, unknown> = {}) {
  return {
    id: 'p1', ownerId: 'o1', placeId: 'pl1', speciesSlug: 'ficus-lyrata', nickname: 'Gus',
    acquiredOn: '2026-01-01', speciesScientificName: 'Ficus lyrata', speciesCommonNameEs: null,
    speciesCommonNameEn: null, coverImageUrl: null, speciesGrowthHabit: null,
    lifecycleState: 'ACTIVE', frozenPlaceLabel: null, frozenCityLabel: null,
    latestProgress: null,
    ...overrides,
  };
}

const memorializePlantMock = vi.fn(async () => basePlant({ lifecycleState: 'MEMORIAL' }));
const giftPlantMock = vi.fn(async () => basePlant({ lifecycleState: 'GIFTED' }));
const revivePlantMock = vi.fn(async () => basePlant({ lifecycleState: 'ACTIVE' }));

function stubApi(plant: ReturnType<typeof basePlant>) {
  vi.stubGlobal('useApi', () => ({
    getPlant: async () => plant,
    getPlantCare: async () => null,
    listPlaces: async () => [{ id: 'pl1', ownerId: 'o1', name: 'Study', indoor: true }],
    getPlantHistory: async () => [],
    getPlantPhotos: async () => [],
    // The REPOT info modal's signs section (Task 28) is a deferred, client-only, unconditional read —
    // fired on every mount regardless of whether this test ever opens that modal — so every useApi stub in
    // this file needs it, even though none of these tests exercise the REPOT flow itself.
    getRepotSigns: async () => ({ signs: [] }),
    getSoilReadings: async () => ({ instruments: [], protocol: null, readings: [] }),
    // Task 6 (watering-survey-web plan): PlantDetail.vue now reads this unconditionally (mirrors
    // pages/index.vue's own WATER survey wiring, commit ff75f51) — every stub in this file needs it, even
    // the ones whose tests never touch the WATER survey. Defaulted to "the owner selected nothing" so every
    // PRE-EXISTING test here (none of which concerns itself with `canSurvey`) keeps its exact pre-Task-6
    // behaviour; the dedicated WATER describe block below overrides it per test.
    getOwnerInstruments: async () => ({ available: [], selected: [] as string[] }),
    invalidatePlant: vi.fn(),
    memorializePlant: memorializePlantMock,
    giftPlant: giftPlantMock,
    revivePlant: revivePlantMock,
  }));
}

// UiConfirmModal/UiModal/UiButton/UiFormGroup/UiSelectField are collapsed to REAL v-model / event
// contracts (same technique NoteModal.test.ts uses for the identical UiConfirmModal component) — every
// other child (ScreenHeader, cards, the note/edit/progress/record/profile modals, the reason pickers…) is
// shallow-stubbed since this file's only concern is the lifecycle-action affordances PlantDetail.vue
// itself renders, not their internals.
const UiButtonStub = {
  props: ['disabled', 'loading', 'color', 'variant', 'icon', 'block', 'size', 'to'],
  emits: ['click'],
  template: '<button :disabled="disabled" @click="$emit(\'click\', $event)"><slot /></button>',
};
const UiConfirmModalStub = {
  props: ['modelValue', 'title', 'message', 'confirmLabel', 'confirmIcon', 'cancelLabel'],
  emits: ['update:modelValue', 'confirm'],
  template:
    '<div v-if="modelValue" class="confirm-modal"><span class="confirm-title">{{ title }}</span>' +
    '<span class="confirm-message">{{ message }}</span>' +
    '<button class="confirm-yes" @click="$emit(\'confirm\')">{{ confirmLabel }}</button></div>',
};
const UiModalStub = {
  props: ['modelValue', 'title'],
  emits: ['update:modelValue'],
  template: '<div v-if="modelValue" class="generic-modal"><span class="modal-title">{{ title }}</span><slot /><slot name="footer" /></div>',
};
const UiFormGroupStub = {
  props: ['label', 'error'],
  template: '<div><span class="fg-label">{{ label }}</span><slot /><span v-if="error" class="fg-error">{{ error }}</span></div>',
};
const UiSelectFieldStub = {
  props: ['modelValue', 'options', 'placeholder', 'disabled'],
  emits: ['update:modelValue'],
  template:
    '<select class="revive-select" :value="modelValue" :disabled="disabled" ' +
    '@change="$emit(\'update:modelValue\', $event.target.value)">' +
    '<option v-for="opt in options" :key="opt.value" :value="opt.value">{{ opt.label }}</option></select>',
};

const stubs = {
  UiScreenHeader: true,
  UiAlert: true,
  UiPlantPhoto: {
    name: 'UiPlantPhoto',
    props: ['src', 'alt', 'height', 'clickable', 'openLabel'],
    emits: ['open'],
    template:
      '<div><button v-if="clickable" class="stub-photo-open" @click="$emit(\'open\')" /><slot name="chips" /><slot name="overlay" /></div>',
  },
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
  UiTaskRow: true,
  // The real TaskRow's own three imports (LOCAL names it resolves via its own `<script setup>` imports —
  // distinct from the `UiAppIcon`/`UiButton` entries above, which are THIS file's auto-imported names for
  // its own top-level markup). `Button` exposes `data-icon`, which is how `doneButtons`/`evaluateButtons`/
  // `postponeButtons` below name an action: `check` = Done, `magnifying-glass` = the survey/questionnaire,
  // `clock` = Postpone — the same convention `TaskRow.test.ts` and `pages/index.test.ts` (Task 2) use.
  AppIcon: true,
  Badge: { template: '<span class="stub-badge"><slot /></span>' },
  Button: {
    props: ['size', 'color', 'variant', 'icon', 'disabled', 'loading'],
    template: '<button class="stub-btn" :data-icon="icon" :data-variant="variant"><slot /></button>',
  },
  HistoryTimeline: true,
  UiImageDropzone: true,
  UiAutosizeTextarea: true,
  UiReasonPicker: true,
  UiTaskInfoModal: true,
  UiImageLightbox: {
    name: 'UiImageLightbox',
    props: ['modelValue', 'images', 'index'],
    template: '<div class="stub-lightbox" />',
  },
  PlantEditModal: true,
  ProgressEntryModal: true,
  ClinicalRecordModal: true,
  NoteModal: true,
  PlantProfileModal: true,
  UiRepotEvaluationModal: true,
  UiRepotVerdictModal: true,
  UiRepotDoneForm: true,
  UiSoilReadingModal: true,
  NuxtLink: { template: '<a><slot /></a>' },
  UiButton: UiButtonStub,
  UiModal: UiModalStub,
  UiConfirmModal: UiConfirmModalStub,
  UiFormGroup: UiFormGroupStub,
  UiSelectField: UiSelectFieldStub,
};

// One place that knows how an action is named on a real row, so a future assertion cannot invent a second
// convention. Scoped to a card when a card is passed, whole-page otherwise. Same names/semantics as
// `pages/index.test.ts`'s identical helpers (Task 2), deliberately.
type Findable = { findAll: (s: string) => Array<{ attributes: (a: string) => string | undefined }> };
const byIcon = (w: Findable, icon: string) =>
  (w.findAll('.stub-btn') as any[]).filter((b) => b.attributes('data-icon') === icon);
const doneButtons = (w: Findable) => byIcon(w, 'check');
const evaluateButtons = (w: Findable) => byIcon(w, 'magnifying-glass');
const postponeButtons = (w: Findable) => byIcon(w, 'clock');

// The real row carries no data-task attribute — it is identified by its own label, which the mocked
// `taskLabel` renders as the task code itself. One helper, so no case re-invents the lookup (Task 4).
const taskRowFor = (w: any, task: string) => {
  const row = w.findAll('.mp-taskrow').find((r: any) => r.find('.mp-taskrow__label').text() === task);
  if (!row) throw new Error(`no task row for "${task}"`);
  return row;
};

async function mountDetail(plant: ReturnType<typeof basePlant>) {
  stubApi(plant);
  const PlantDetail = (await import('./PlantDetail.vue')).default;
  const w = mount(
    { components: { PlantDetail }, template: '<Suspense><PlantDetail id="p1" /></Suspense>' },
    { global: { stubs, mocks: { $t: i18n.t, $d: (v: unknown) => String(v) } } },
  );
  await flushPromises();
  return w.findComponent(PlantDetail);
}

function findButtonByText(w: ReturnType<typeof mount>, text: string) {
  const btn = w.findAll('button').find((b) => b.text() === text);
  if (!btn) throw new Error(`no button with text "${text}"`);
  return btn;
}

beforeEach(() => {
  // Store-isolation (W1): reset BOTH module-scope attempt stores before every test so no test's outstanding
  // key/body/error survives into the next one.
  __resetRepotAttemptStoresForTests();
  memorializePlantMock.mockClear();
  giftPlantMock.mockClear();
  revivePlantMock.mockClear();
  navigateToMock.mockClear();
  // F3: no test inherits a previous one's `?calibrate=1` arrival.
  routeQuery = {};
  routerReplaceMock.mockClear();
});

describe('PlantDetail lifecycle actions — visibility gating', () => {
  it('shows memorialize + gift (never revive) for an ACTIVE plant', async () => {
    const w = await mountDetail(basePlant({ lifecycleState: 'ACTIVE' }));
    expect(w.text()).toContain('Move to pantheon');
    expect(w.text()).toContain('Gift');
    expect(w.text()).not.toContain('Return to my garden');
  });

  it('shows ONLY revive for a GIFTED plant', async () => {
    const w = await mountDetail(basePlant({
      lifecycleState: 'GIFTED', frozenPlaceLabel: 'Study', frozenCityLabel: 'CDMX',
    }));
    expect(w.text()).toContain('Return to my garden');
    expect(w.text()).not.toContain('Move to pantheon');
    // "Gift" alone would also match inside "Gifted plants"/other unrelated copy, so this assertion checks
    // the actual action button is absent rather than the bare substring.
    expect(w.findAll('button').some((b) => b.text() === 'Gift')).toBe(false);
  });

  it('shows NO lifecycle action for a MEMORIAL plant — the pantheon is terminal, there is no way back', async () => {
    const w = await mountDetail(basePlant({
      lifecycleState: 'MEMORIAL', frozenPlaceLabel: 'Study', frozenCityLabel: 'CDMX',
    }));
    expect(w.findAll('button').some((b) => b.text() === 'Move to pantheon')).toBe(false);
    expect(w.findAll('button').some((b) => b.text() === 'Gift')).toBe(false);
    expect(w.findAll('button').some((b) => b.text() === 'Return to my garden')).toBe(false);
  });
});

describe('PlantDetail lifecycle actions — pantheon permanence copy', () => {
  it('the Move to pantheon confirmation explicitly warns the action is permanent', async () => {
    const w = await mountDetail(basePlant());
    await findButtonByText(w, 'Move to pantheon').trigger('click');
    await flushPromises();
    expect(w.get('.confirm-message').text().toLowerCase()).toContain('this action is permanent');
  });

  it('(es) the same confirmation reads "esta acción es permanente"', async () => {
    i18n.locale.value = 'es';
    try {
      const w = await mountDetail(basePlant());
      await findButtonByText(w, 'Mover al panteón').trigger('click');
      await flushPromises();
      expect(w.get('.confirm-message').text().toLowerCase()).toContain('esta acción es permanente');
    } finally {
      i18n.locale.value = 'en';
    }
  });
});

describe('PlantDetail lifecycle actions — wiring', () => {
  it('confirming Move to pantheon calls memorializePlant(id) then routes to /pantheon/:id', async () => {
    const w = await mountDetail(basePlant());
    await findButtonByText(w, 'Move to pantheon').trigger('click');
    await flushPromises();
    await w.get('.confirm-yes').trigger('click');
    await flushPromises();

    expect(memorializePlantMock).toHaveBeenCalledWith('p1');
    expect(giftPlantMock).not.toHaveBeenCalled();
    expect(navigateToMock).toHaveBeenCalledWith('/pantheon/p1');
  });

  it('confirming Gift calls giftPlant(id) then routes to /gifted/:id', async () => {
    const w = await mountDetail(basePlant());
    await findButtonByText(w, 'Gift').trigger('click');
    await flushPromises();
    await w.get('.confirm-yes').trigger('click');
    await flushPromises();

    expect(giftPlantMock).toHaveBeenCalledWith('p1');
    expect(memorializePlantMock).not.toHaveBeenCalled();
    expect(navigateToMock).toHaveBeenCalledWith('/gifted/p1');
  });

  it('revive keeps confirm disabled until a place is chosen, then calls revivePlant(id, placeId) and routes to /plants/:id', async () => {
    const w = await mountDetail(basePlant({ lifecycleState: 'GIFTED' }));
    await findButtonByText(w, 'Return to my garden').trigger('click');
    await flushPromises();

    // The trigger ("Return to my garden") stays rendered behind the now-open modal; the modal's own confirm
    // reads "Bring it back" and lives inside `.generic-modal`, starting disabled (no place chosen yet).
    const modalConfirm = w.get('.generic-modal').findAll('button').find((b) => b.text() === 'Bring it back')!;
    expect((modalConfirm.element as HTMLButtonElement).disabled).toBe(true);

    await w.get('.revive-select').setValue('pl1');
    await flushPromises();

    const confirmAfter = w.get('.generic-modal').findAll('button').find((b) => b.text() === 'Bring it back')!;
    expect((confirmAfter.element as HTMLButtonElement).disabled).toBe(false);

    await confirmAfter.trigger('click');
    await flushPromises();

    expect(revivePlantMock).toHaveBeenCalledWith('p1', 'pl1');
    expect(navigateToMock).toHaveBeenCalledWith('/plants/p1');
  });
});

// Async photo reconcile (stale-gallery fix). Progress + import photos are processed by a background worker
// AFTER the write returns, so the gallery's one on-mount refetch lands while they are still PENDING and the
// new photos would stay invisible until a manual reload. While the history reports any still-processing
// photo (`processingCount` > 0), the detail must refetch the gallery/history/plant on a bounded interval,
// then STOP the instant everything settles (READY/FAILED). This pins that live-catch-up and its termination.
describe('PlantDetail — async photo reconcile', () => {
  // A lazy stub whose refresh actually RE-RUNS the fetcher, so a settling history (processingCount 1 → 0)
  // can flow through and stop the reconcile — the shared top-level stub's refresh is a no-op.
  const rerunLazyStub = (_key: string, fn: () => Promise<unknown>) => {
    const data = ref<unknown>(null);
    const run = () => Promise.resolve(fn()).then((v) => { data.value = v; });
    void run();
    return { data, refresh: vi.fn(run) };
  };

  afterEach(() => {
    vi.useRealTimers();
    // Restore the module's default lazy stub (no-op refresh) for the rest of the suite.
    vi.stubGlobal('useLazyAsyncData', (_key: string, fn: () => Promise<unknown>) => {
      const data = ref<unknown>(null);
      void Promise.resolve(fn()).then((v) => { data.value = v; });
      return { data, refresh: vi.fn(async () => {}) };
    });
  });

  function progressHistory(processingCount: number) {
    return [{
      kind: 'progress', entryId: 'e1', occurredOn: '2026-01-01', health: 'GOOD',
      photoCount: 0, processingCount, tagCount: 0,
    }];
  }

  it('refetches the gallery while a photo is processing, then stops once it settles', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('useLazyAsyncData', rerunLazyStub);
    let processing = 1; // the just-added photo is mid-processing
    const getPlantHistory = vi.fn(async () => progressHistory(processing));
    const getPlantPhotos = vi.fn(async () => []);
    const invalidatePlant = vi.fn();
    vi.stubGlobal('useApi', () => ({
      getPlant: async () => basePlant(),
      getPlantCare: async () => null,
      listPlaces: async () => [],
      getPlantHistory,
      getPlantPhotos,
      getRepotSigns: async () => ({ signs: [] }),
      getSoilReadings: async () => ({ instruments: [], protocol: null, readings: [] }),
      // Task 6: see the shared `stubApi` helper's identical comment — every `useApi` stub in this file
      // needs this now that PlantDetail.vue reads it unconditionally.
      getOwnerInstruments: async () => ({ available: [], selected: [] as string[] }),
      invalidatePlant,
    }));

    const PlantDetail = (await import('./PlantDetail.vue')).default;
    const w = mount(
      { components: { PlantDetail }, template: '<Suspense><PlantDetail id="p1" /></Suspense>' },
      { global: { stubs, mocks: { $t: i18n.t, $d: (v: unknown) => String(v) } } },
    );
    await flushPromises(); // initial reads resolve → history has processingCount 1 → reconcile arms
    const photosAfterMount = getPlantPhotos.mock.calls.length;

    // The worker finishes; the NEXT reconcile refetch will observe processingCount 0.
    processing = 0;
    await vi.advanceTimersByTimeAsync(2500);
    await flushPromises();
    // The reconcile fired at least one extra gallery refetch (the live catch-up)...
    expect(getPlantPhotos.mock.calls.length).toBeGreaterThan(photosAfterMount);
    // ...and it dropped this plant's cached reads FIRST, or the page-lifetime GET cache would re-serve the
    // pre-processing value and the refetch above would be a silent no-op (the real QA-caught failure).
    expect(invalidatePlant).toHaveBeenCalledWith('p1');

    // Now that nothing is processing, the reconcile MUST stop — no further gallery refetches.
    const settledCalls = getPlantPhotos.mock.calls.length;
    await vi.advanceTimersByTimeAsync(2500 * 4);
    await flushPromises();
    expect(getPlantPhotos.mock.calls.length).toBe(settledCalls);

    w.unmount();
  });

  it('never arms the reconcile when no photo is processing', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('useLazyAsyncData', rerunLazyStub);
    const getPlantPhotos = vi.fn(async () => []);
    vi.stubGlobal('useApi', () => ({
      getPlant: async () => basePlant(),
      getPlantCare: async () => null,
      listPlaces: async () => [],
      getPlantHistory: async () => progressHistory(0), // all photos already READY
      getPlantPhotos,
      getRepotSigns: async () => ({ signs: [] }),
      getSoilReadings: async () => ({ instruments: [], protocol: null, readings: [] }),
      // Task 6: see the shared `stubApi` helper's identical comment — every `useApi` stub in this file
      // needs this now that PlantDetail.vue reads it unconditionally.
      getOwnerInstruments: async () => ({ available: [], selected: [] as string[] }),
      invalidatePlant: vi.fn(),
    }));

    const PlantDetail = (await import('./PlantDetail.vue')).default;
    const w = mount(
      { components: { PlantDetail }, template: '<Suspense><PlantDetail id="p1" /></Suspense>' },
      { global: { stubs, mocks: { $t: i18n.t, $d: (v: unknown) => String(v) } } },
    );
    await flushPromises();
    const photosAfterMount = getPlantPhotos.mock.calls.length;
    await vi.advanceTimersByTimeAsync(2500 * 4);
    await flushPromises();
    expect(getPlantPhotos.mock.calls.length).toBe(photosAfterMount); // no polling

    w.unmount();
  });
});

// Task 16 / Request 9. The cover photo behaves like a gallery photo: it opens.
describe('PlantDetail — the cover photo opens in the shared lightbox', () => {
  it('opens the lightbox with the cover photo alone', async () => {
    const w = await mountDetail(basePlant({ coverImageUrl: 'https://cdn/cover.jpg' }));
    await w.find('.stub-photo-open').trigger('click');
    await flushPromises();

    const lightbox = w.findAllComponents({ name: 'UiImageLightbox' }).find((l) => l.props('modelValue') === true)!;
    expect(lightbox).toBeTruthy();
    // ONE image — the cover is not part of the gallery's paging sequence, and `hasNav` renders no arrows
    // for a single-image list.
    expect(lightbox.props('images')).toHaveLength(1);
    expect(lightbox.props('images')[0].src).toBe('https://cdn/cover.jpg');
  });

  it('offers no open affordance when the plant has no cover photo', async () => {
    const w = await mountDetail(basePlant({ coverImageUrl: null }));
    expect(w.findComponent({ name: 'UiPlantPhoto' }).props('clickable')).toBe(false);
  });

  // FREEZING FORBIDS MUTATION, NOT LOOKING. A frozen plant hides every editing action — but the photo
  // viewer is a read, and suppressing it here would be over-applying the freeze to the one thing the
  // pantheon exists for.
  it.each([['MEMORIAL'], ['GIFTED']])('still opens for a frozen (%s) plant', async (state) => {
    const w = await mountDetail(
      basePlant({ lifecycleState: state, coverImageUrl: 'https://cdn/cover.jpg', frozenPlaceLabel: 'Study', frozenCityLabel: 'CDMX' }),
    );
    await w.find('.stub-photo-open').trigger('click');
    await flushPromises();
    const lightbox = w.findAllComponents({ name: 'UiImageLightbox' }).find((l) => l.props('modelValue') === true)!;
    expect(lightbox).toBeTruthy();
  });
});

// Round-5 finding V1: PlantDetail.vue is the SECOND renderer of the REPOT evaluation/Done flows
// (pages/index.vue is the first) — round-4's V1 fixed the "submitting gets stuck" race there via a single
// attempt object (`useRepotAttempt.ts`, now shared by both files), but PlantDetail.vue kept SEPARATE
// `evaluationSubmitting`/`evaluationKey` and `doneFormSubmitting`/`doneKey` refs with an unconditional
// `finally`, reopening the identical race here. These tests are shown FAILING against the pre-fix code
// (each pins the exact sequence the finding describes: a successful confirm/submit clears its OWN attempt
// and closes its OWN modal BEFORE awaiting `refresh()`; while that await is still pending, the owner
// reopens and resubmits; the FIRST attempt's late `refresh()` must never clobber the SECOND, still-live
// attempt's `submitting` flag) and PASS once `useRepotAttempt.ts`'s single-object-with-identity-check
// pattern is applied here too.
describe('PlantDetail — round-5 finding V1: the submitting flag must never get stuck across two attempts for the SAME plant', () => {
  function deferred<T>() {
    let resolve!: (v: T) => void;
    const promise = new Promise<T>((res) => { resolve = res; });
    return { promise, resolve };
  }

  const repotPlant = () => ({
    ...basePlant(),
    profile: { potSizeCm: 20, soilMix: 'potting-mix' },
  });

  const repotCare = {
    plantId: 'p1',
    tasks: [{ task: 'REPOT', status: 'today', daysUntilDue: 0, pendingEvaluation: null }],
  };

  const repotStubs = {
    ...stubs,
    // The REAL row (spec §5.1) — TaskRow.vue's own AppIcon/Badge/Button children resolve via the
    // file-level `stubs` spread above (AppIcon/Badge/Button entries added for exactly this). `evaluate-btn`/
    // `done-btn` no longer exist as classes; the real row's actions are found by icon
    // (`evaluateButtons`/`doneButtons` below), same convention as `pages/index.test.ts` (Task 2).
    UiTaskRow: TaskRow,
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
      emits: ['confirm', 'start-over'],
      template:
        '<div class="done-form" :data-open="open" :data-frozen="frozen" :data-submitting="submitting">' +
        // Task 28: the real form's `confirm` payload always carries `occurredOn` now — this test does not
        // assert on its value, so a literal keeps the stub faithful to the widened contract without
        // pulling in the seed/frozen-snapshot machinery the OTHER describe blocks below exercise.
        '<button class="confirm-btn" @click="$emit(\'confirm\', { potSizeCm: currentPotSizeCm, soilMix: currentSoilMix, charged: true, occurredOn: \'2026-01-01\' })">confirm</button>' +
        '</div>',
    },
  };

  // A controllable `care-${id}` `refresh()` — the `await Promise.all([refresh(), refreshHistory()])` /
  // `await Promise.all([refresh(), refreshHistory(), refreshPlant()])` calls both onEvaluationSubmit and
  // onRepotDoneConfirm make on success — lets the test hold the FIRST attempt's success mid-flight (past
  // the point where it already cleared its own attempt and closed its own modal) so a SECOND attempt can
  // start DURING that window, exactly the gap round-4's V1 (and now round-5's V1) closes.
  let careRefreshDeferred: ReturnType<typeof deferred<void>>;

  beforeEach(() => {
    careRefreshDeferred = deferred<void>();
    vi.stubGlobal('useAsyncData', async (key: string, fn: () => Promise<unknown>) => ({
      data: ref(await fn()),
      refresh: key.startsWith('care-') ? vi.fn(() => careRefreshDeferred.promise) : vi.fn(async () => {}),
    }));
  });

  afterEach(() => {
    // Restore the module's default (non-deferred) stub for every other describe block in this file.
    vi.stubGlobal('useAsyncData', async (_key: string, fn: () => Promise<unknown>) => ({
      data: ref(await fn()),
      refresh: vi.fn(async () => {}),
    }));
  });

  async function mountRepot() {
    vi.stubGlobal('useApi', () => ({
      getPlant: async () => repotPlant(),
      getPlantCare: async () => repotCare,
      listPlaces: async () => [],
      getPlantHistory: async () => [],
      getPlantPhotos: async () => [],
      getRepotSigns: async () => ({ signs: [] }),
      getSoilReadings: async () => ({ instruments: [], protocol: null, readings: [] }),
      // Task 6: see the shared `stubApi` helper's identical comment — every `useApi` stub in this file
      // needs this now that PlantDetail.vue reads it unconditionally.
      getOwnerInstruments: async () => ({ available: [], selected: [] as string[] }),
      invalidatePlant: vi.fn(),
      submitRepotEvaluation: submitRepotEvaluationMock,
      completeRepot: completeRepotMock,
    }));
    const PlantDetail = (await import('./PlantDetail.vue')).default;
    const w = mount(
      { components: { PlantDetail }, template: '<Suspense><PlantDetail id="p1" /></Suspense>' },
      { global: { stubs: repotStubs, mocks: { $t: i18n.t, $d: (v: unknown) => String(v) } } },
    );
    await flushPromises();
    return w;
  }

  let submitDeferreds: ReturnType<typeof deferred<{ evaluationId: string; verdict: string }>>[];
  let submitRepotEvaluationMock: ReturnType<typeof vi.fn>;
  let completeRepotDeferreds: ReturnType<typeof deferred<{ ok: true }>>[];
  let completeRepotMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    submitDeferreds = [deferred(), deferred()];
    let submitCall = 0;
    submitRepotEvaluationMock = vi.fn(async () => submitDeferreds[submitCall++]!.promise);
    completeRepotDeferreds = [deferred(), deferred()];
    let completeCall = 0;
    completeRepotMock = vi.fn(async () => completeRepotDeferreds[completeCall++]!.promise);
  });

  it('onEvaluationSubmit: a stale success must not clear a NEWER attempt\'s submitting flag when its own ' +
    'refresh() resolves late', async () => {
    const w = await mountRepot();

    // First attempt: open + submit, succeeds, but the care refresh() is held open.
    await evaluateButtons(w)[0]!.trigger('click');
    await flushPromises();
    await w.find('.submit-btn').trigger('click');
    await flushPromises();
    submitDeferreds[0]!.resolve({ evaluationId: 'ev-1', verdict: 'REPOT' });
    await flushPromises();
    // The first attempt's own modal already closed and its own attempt was already cleared — its
    // refresh() is what's still pending.
    expect(w.find('.eval-modal').attributes('data-open')).toBe('false');

    // While the first attempt's refresh() is still pending, the owner reopens and submits AGAIN.
    await evaluateButtons(w)[0]!.trigger('click');
    await flushPromises();
    await w.find('.submit-btn').trigger('click');
    await flushPromises();
    expect(w.find('.eval-modal').attributes('data-submitting')).toBe('true');

    // The FIRST attempt's refresh() now finally resolves — its own bookkeeping must NOT touch the SECOND,
    // still-live attempt's submitting flag.
    careRefreshDeferred.resolve();
    await flushPromises();

    expect(w.find('.eval-modal').attributes('data-submitting')).toBe('true');
  });

  it('onRepotDoneConfirm: a stale success must not clear a NEWER attempt\'s submitting flag when its own ' +
    'refresh() resolves late', async () => {
    const w = await mountRepot();

    // First attempt: open + confirm, succeeds, but the care refresh() is held open.
    await doneButtons(w)[0]!.trigger('click');
    await flushPromises();
    await w.find('.confirm-btn').trigger('click');
    await flushPromises();
    completeRepotDeferreds[0]!.resolve({ ok: true });
    await flushPromises();
    expect(w.find('.done-form').attributes('data-open')).toBe('false');

    // While the first attempt's refresh() is still pending, the owner reopens and confirms AGAIN.
    await doneButtons(w)[0]!.trigger('click');
    await flushPromises();
    await w.find('.confirm-btn').trigger('click');
    await flushPromises();
    expect(w.find('.done-form').attributes('data-submitting')).toBe('true');

    // The FIRST attempt's refresh() now finally resolves — its own bookkeeping must NOT touch the SECOND,
    // still-live attempt's submitting flag.
    careRefreshDeferred.resolve();
    await flushPromises();

    expect(w.find('.done-form').attributes('data-submitting')).toBe('true');
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
// in this same review) and pages/index.vue's identical B1 fix, applied here — the SECOND renderer.
describe('PlantDetail — B1: the Done form must resume its outstanding attempt across close and reopen', () => {
  function deferred<T>() {
    let resolve!: (v: T) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
  }

  const repotPlant = () => ({
    ...basePlant(),
    profile: { potSizeCm: 20, soilMix: 'potting-mix' },
  });

  const repotCare = {
    plantId: 'p1',
    tasks: [{ task: 'REPOT', status: 'today', daysUntilDue: 0, pendingEvaluation: null }],
  };

  const repotStubs = {
    ...stubs,
    // The REAL row (spec §5.1) — TaskRow.vue's own AppIcon/Badge/Button children resolve via the
    // file-level `stubs` spread above (AppIcon/Badge/Button entries added for exactly this). `evaluate-btn`/
    // `done-btn` no longer exist as classes; the real row's actions are found by icon
    // (`evaluateButtons`/`doneButtons` below), same convention as `pages/index.test.ts` (Task 2).
    UiTaskRow: TaskRow,
    UiRepotDoneForm: {
      props: ['open', 'currentPotSizeCm', 'currentSoilMix', 'submitting', 'error', 'frozen'],
      emits: ['confirm', 'start-over', 'update:open'],
      template:
        '<div class="done-form" :data-open="open" :data-frozen="frozen" :data-submitting="submitting">' +
        // Task 28: literal `occurredOn` — this test does not assert on its value, only that the SAME key
        // is resent on resume; see the seed/frozen-snapshot-driven stubs below for the tests that do care.
        '<button class="confirm-btn" @click="$emit(\'confirm\', { potSizeCm: currentPotSizeCm, soilMix: currentSoilMix, charged: true, occurredOn: \'2026-01-01\' })">confirm</button>' +
        // A close button that drives the REAL v-model:open contract (X/Escape/backdrop in the real
        // component), never an internal function — this is how the resume test simulates the owner
        // dismissing the form without resolving an outstanding confirm.
        '<button class="close-btn" @click="$emit(\'update:open\', false)">close</button>' +
        '</div>',
    },
  };

  let completeRepotDeferreds: ReturnType<typeof deferred<{ ok: true }>>[];
  let completeRepotMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    completeRepotDeferreds = [deferred(), deferred()];
    let completeCall = 0;
    completeRepotMock = vi.fn(async () => completeRepotDeferreds[completeCall++]!.promise);
  });

  async function mountRepot() {
    vi.stubGlobal('useApi', () => ({
      getPlant: async () => repotPlant(),
      getPlantCare: async () => repotCare,
      listPlaces: async () => [],
      getPlantHistory: async () => [],
      getPlantPhotos: async () => [],
      getRepotSigns: async () => ({ signs: [] }),
      getSoilReadings: async () => ({ instruments: [], protocol: null, readings: [] }),
      // Task 6: see the shared `stubApi` helper's identical comment — every `useApi` stub in this file
      // needs this now that PlantDetail.vue reads it unconditionally.
      getOwnerInstruments: async () => ({ available: [], selected: [] as string[] }),
      invalidatePlant: vi.fn(),
      completeRepot: completeRepotMock,
    }));
    const PlantDetail = (await import('./PlantDetail.vue')).default;
    const w = mount(
      { components: { PlantDetail }, template: '<Suspense><PlantDetail id="p1" /></Suspense>' },
      { global: { stubs: repotStubs, mocks: { $t: i18n.t, $d: (v: unknown) => String(v) } } },
    );
    await flushPromises();
    return w;
  }

  it('a failed confirm keeps the key; closing the form via its own update:open contract and reopening ' +
    'resumes it — the retry sends the SAME idempotency key, and the form is still frozen', async () => {
    const w = await mountRepot();

    await doneButtons(w)[0]!.trigger('click');
    await flushPromises();
    await w.find('.confirm-btn').trigger('click');
    await flushPromises();
    completeRepotDeferreds[0]!.reject(new Error('lost response'));
    await flushPromises();

    expect(completeRepotMock).toHaveBeenCalledTimes(1);
    const keyFirst = completeRepotMock.mock.calls[0]![3];
    expect(keyFirst).toBeTruthy();
    expect(w.find('.done-form').attributes('data-frozen')).toBe('true');

    // Close via the component's own update:open / v-model:open contract (X/Escape/backdrop) — NOT by
    // calling an internal function — without resolving the outstanding confirm.
    await w.find('.close-btn').trigger('click');
    await flushPromises();
    expect(w.find('.done-form').attributes('data-open')).toBe('false');

    // Reopen via the Done button: must RESUME, not reset — this component is pinned to one plant, so a
    // resume just means "a key is already outstanding".
    await doneButtons(w)[0]!.trigger('click');
    await flushPromises();
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

  it('a successful confirm leaves no outstanding key — reopening afterwards is a fresh attempt, not a resume', async () => {
    const w = await mountRepot();

    await doneButtons(w)[0]!.trigger('click');
    await flushPromises();
    await w.find('.confirm-btn').trigger('click');
    await flushPromises();
    completeRepotDeferreds[0]!.resolve({ ok: true });
    await flushPromises();
    const keyFirst = completeRepotMock.mock.calls[0]![3];
    expect(w.find('.done-form').attributes('data-open')).toBe('false');

    await doneButtons(w)[0]!.trigger('click');
    await flushPromises();
    expect(w.find('.done-form').attributes('data-frozen')).toBe('false'); // fresh attempt, not resumed

    await w.find('.confirm-btn').trigger('click');
    await flushPromises();
    const keySecond = completeRepotMock.mock.calls[1]![3];
    expect(keySecond).not.toBe(keyFirst); // two genuinely separate confirmations must never share a key
  });
});

// U2, updated for Task 28: `occurredOn` is no longer re-derived by PlantDetail.vue itself — it now arrives
// WITH the `UiRepotDoneForm` confirm payload (the form is the one editable date seam, Task 25), and
// `onRepotDoneConfirm` forwards `payload.occurredOn` verbatim. The freeze U2 originally proved still holds,
// one level up: `beginDoneAttempt` snapshots the WHOLE envelope the moment the key is minted and resends the
// STORED envelope (never a freshly-passed one) on every retry. This test proves that by moving the SYSTEM
// CLOCK across a simulated midnight rollover between the failed confirm and the retry — the stub's own
// `occurredOn` recomputes (mirroring the real form's `seedOccurredOn || todayYmd()` default), yet the
// SECOND `completeRepot` call must still carry the FIRST value, because `begin()`'s resume path ignores
// whatever body a retry passes in.
describe('PlantDetail — U2: a retry sends a byte-identical occurredOn across a simulated midnight rollover', () => {
  function deferred<T>() {
    let resolve!: (v: T) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
  }

  const repotPlant = () => ({
    ...basePlant(),
    profile: { potSizeCm: 20, soilMix: 'potting-mix' },
  });

  const repotCare = {
    plantId: 'p1',
    tasks: [{ task: 'REPOT', status: 'today', daysUntilDue: 0, pendingEvaluation: null }],
  };

  const repotStubs = {
    ...stubs,
    // The REAL row (spec §5.1) — TaskRow.vue's own AppIcon/Badge/Button children resolve via the
    // file-level `stubs` spread above (AppIcon/Badge/Button entries added for exactly this). `evaluate-btn`/
    // `done-btn` no longer exist as classes; the real row's actions are found by icon
    // (`evaluateButtons`/`doneButtons` below), same convention as `pages/index.test.ts` (Task 2).
    UiTaskRow: TaskRow,
    UiRepotDoneForm: {
      props: ['open', 'currentPotSizeCm', 'currentSoilMix', 'submitting', 'error', 'frozen', 'seedOccurredOn'],
      emits: ['confirm', 'start-over', 'update:open'],
      // `todayYmd` exposed as a METHOD (not a bare template reference) — Vue's runtime template compiler
      // resolves identifiers off the component instance, so a plain import is invisible inside `template:
      // '…'` unless it is exposed this way. Mirrors the REAL form's own default exactly (`seedOccurredOn ||
      // todayYmd()`, see components/ui/RepotDoneForm.vue's `watch(open, …)`), never a second ad-hoc "today".
      methods: { todayYmd },
      template:
        '<div class="done-form" :data-open="open" :data-frozen="frozen" :data-submitting="submitting">' +
        '<button class="confirm-btn" @click="$emit(\'confirm\', { potSizeCm: currentPotSizeCm, soilMix: currentSoilMix, charged: true, occurredOn: seedOccurredOn || todayYmd() })">confirm</button>' +
        '</div>',
    },
  };

  let completeRepotDeferreds: ReturnType<typeof deferred<{ ok: true }>>[];
  let completeRepotMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    completeRepotDeferreds = [deferred(), deferred()];
    let completeCall = 0;
    completeRepotMock = vi.fn(async () => completeRepotDeferreds[completeCall++]!.promise);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function mountRepot() {
    vi.stubGlobal('useApi', () => ({
      getPlant: async () => repotPlant(),
      getPlantCare: async () => repotCare,
      listPlaces: async () => [],
      getPlantHistory: async () => [],
      getPlantPhotos: async () => [],
      getRepotSigns: async () => ({ signs: [] }),
      getSoilReadings: async () => ({ instruments: [], protocol: null, readings: [] }),
      // Task 6: see the shared `stubApi` helper's identical comment — every `useApi` stub in this file
      // needs this now that PlantDetail.vue reads it unconditionally.
      getOwnerInstruments: async () => ({ available: [], selected: [] as string[] }),
      invalidatePlant: vi.fn(),
      completeRepot: completeRepotMock,
    }));
    const PlantDetail = (await import('./PlantDetail.vue')).default;
    const w = mount(
      { components: { PlantDetail }, template: '<Suspense><PlantDetail id="p1" /></Suspense>' },
      { global: { stubs: repotStubs, mocks: { $t: i18n.t, $d: (v: unknown) => String(v) } } },
    );
    await flushPromises();
    return w;
  }

  it('holds the ORIGINAL occurredOn on a retry sent after the clock rolled over to the next calendar day', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 0, 1, 23, 59, 0)); // Jan 1, 23:59 local

    const w = await mountRepot();

    await doneButtons(w)[0]!.trigger('click');
    await flushPromises();
    await w.find('.confirm-btn').trigger('click');
    await flushPromises();
    completeRepotDeferreds[0]!.reject(new Error('lost response'));
    await flushPromises();

    expect(completeRepotMock).toHaveBeenCalledTimes(1);
    const firstOccurredOn = completeRepotMock.mock.calls[0]![1];
    expect(firstOccurredOn).toBe('2026-01-01');
    expect(w.find('.done-form').attributes('data-frozen')).toBe('true');

    // The clock rolls over past midnight before the owner retries.
    vi.setSystemTime(new Date(2026, 0, 2, 0, 5, 0)); // Jan 2, 00:05 local

    await w.find('.confirm-btn').trigger('click');
    await flushPromises();
    expect(completeRepotMock).toHaveBeenCalledTimes(2);
    const secondOccurredOn = completeRepotMock.mock.calls[1]![1];
    // The retry must still carry the ORIGINAL day — never the new one the clock now reads.
    expect(secondOccurredOn).toBe(firstOccurredOn);
    expect(secondOccurredOn).toBe('2026-01-01');
  });
});

// U2's sibling case: `evaluationId` is read fresh off `pendingRepotEvaluation` (sourced from the `care-${id}`
// read) at EVERY confirm click too. An intervening `refresh()` — from any other flow that re-reads this
// plant's care — must not let a retry carry a DIFFERENT evaluationId than the one its key was minted for.
describe('PlantDetail — U2: a retry resends the ORIGINAL evaluationId even after an intervening care refresh()', () => {
  function deferred<T>() {
    let resolve!: (v: T) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
  }

  const repotPlant = () => ({
    ...basePlant(),
    profile: { potSizeCm: 20, soilMix: 'potting-mix' },
  });

  type RepotCare = {
    plantId: string;
    tasks: Array<{
      task: string; status: string; daysUntilDue: number;
      pendingEvaluation: { id: string; verdict: string } | null;
    }>;
  };
  const careV1: RepotCare = {
    plantId: 'p1',
    tasks: [{ task: 'REPOT', status: 'today', daysUntilDue: 0, pendingEvaluation: { id: 'ev-1', verdict: 'REPOT' } }],
  };
  const careV2: RepotCare = {
    plantId: 'p1',
    tasks: [{ task: 'REPOT', status: 'today', daysUntilDue: 0, pendingEvaluation: { id: 'ev-2', verdict: 'REPOT' } }],
  };

  const repotStubs = {
    ...stubs,
    // The REAL row (spec §5.1) — TaskRow.vue's own AppIcon/Badge/Button children resolve via the
    // file-level `stubs` spread above (AppIcon/Badge/Button entries added for exactly this). `evaluate-btn`/
    // `done-btn` no longer exist as classes; the real row's actions are found by icon
    // (`evaluateButtons`/`doneButtons` below), same convention as `pages/index.test.ts` (Task 2).
    UiTaskRow: TaskRow,
    UiRepotDoneForm: {
      props: ['open', 'currentPotSizeCm', 'currentSoilMix', 'submitting', 'error', 'frozen'],
      emits: ['confirm', 'start-over', 'update:open'],
      template:
        '<div class="done-form" :data-open="open" :data-frozen="frozen" :data-submitting="submitting">' +
        '<button class="confirm-btn" @click="$emit(\'confirm\', { potSizeCm: currentPotSizeCm, soilMix: currentSoilMix, charged: true, occurredOn: \'2026-01-01\' })">confirm</button>' +
        '</div>',
    },
  };

  let completeRepotDeferreds: ReturnType<typeof deferred<{ ok: true }>>[];
  let completeRepotMock: ReturnType<typeof vi.fn>;
  let careRef: ReturnType<typeof ref<RepotCare>>;
  let refreshCare: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    completeRepotDeferreds = [deferred(), deferred()];
    let completeCall = 0;
    completeRepotMock = vi.fn(async () => completeRepotDeferreds[completeCall++]!.promise);
    careRef = ref(careV1);
    refreshCare = vi.fn(async () => { careRef.value = careV2; });
    vi.stubGlobal('useAsyncData', async (key: string, fn: () => Promise<unknown>) => {
      if (key.startsWith('care-')) return { data: careRef, refresh: refreshCare };
      return { data: ref(await fn()), refresh: vi.fn(async () => {}) };
    });
  });

  afterEach(() => {
    // Restore the module's default (non-deferred) stub for every other describe block in this file.
    vi.stubGlobal('useAsyncData', async (_key: string, fn: () => Promise<unknown>) => ({
      data: ref(await fn()),
      refresh: vi.fn(async () => {}),
    }));
  });

  async function mountRepot() {
    vi.stubGlobal('useApi', () => ({
      getPlant: async () => repotPlant(),
      getPlantCare: async () => careV1,
      listPlaces: async () => [],
      getPlantHistory: async () => [],
      getPlantPhotos: async () => [],
      getRepotSigns: async () => ({ signs: [] }),
      getSoilReadings: async () => ({ instruments: [], protocol: null, readings: [] }),
      // Task 6: see the shared `stubApi` helper's identical comment — every `useApi` stub in this file
      // needs this now that PlantDetail.vue reads it unconditionally.
      getOwnerInstruments: async () => ({ available: [], selected: [] as string[] }),
      invalidatePlant: vi.fn(),
      completeRepot: completeRepotMock,
    }));
    const PlantDetail = (await import('./PlantDetail.vue')).default;
    const w = mount(
      { components: { PlantDetail }, template: '<Suspense><PlantDetail id="p1" /></Suspense>' },
      { global: { stubs: repotStubs, mocks: { $t: i18n.t, $d: (v: unknown) => String(v) } } },
    );
    await flushPromises();
    return w;
  }

  it('changes the pending evaluation between the failed confirm and the retry, and the retry still sends ' +
    'the FIRST evaluationId', async () => {
    const w = await mountRepot();

    await doneButtons(w)[0]!.trigger('click');
    await flushPromises();
    await w.find('.confirm-btn').trigger('click');
    await flushPromises();
    completeRepotDeferreds[0]!.reject(new Error('lost response'));
    await flushPromises();

    expect(completeRepotMock).toHaveBeenCalledTimes(1);
    const firstPayload = completeRepotMock.mock.calls[0]![2] as { evaluationId?: string };
    expect(firstPayload.evaluationId).toBe('ev-1');

    // Some OTHER flow refreshes this plant's care read before the retry — the pending evaluation now reads
    // 'ev-2'.
    await refreshCare();
    await flushPromises();

    // The retry must still send the ORIGINAL evaluationId, never the one the intervening refresh() surfaced.
    await w.find('.confirm-btn').trigger('click');
    await flushPromises();
    expect(completeRepotMock).toHaveBeenCalledTimes(2);
    const secondPayload = completeRepotMock.mock.calls[1]![2] as { evaluationId?: string };
    expect(secondPayload.evaluationId).toBe('ev-1');
  });
});

// W2's sibling case, specific to PlantDetail.vue: this component is pinned to ONE plant, so a leak here
// cannot cross PLANTS — but it had the exact same shared `repotError` flag serving BOTH the evaluation
// flow and the Done flow for that ONE plant. The ruling names this explicitly as "the same shared-flag
// shape for its two flows", the parallel-copy defect this whole review keeps finding on this file's
// sibling to pages/index.vue. Mirrors pages/index.test.ts's own W2 interleaving shape exactly (same two
// cases, "plant A/B" replaced by "flow eval/done" since there is only one plant here): a flow that is
// STILL genuinely outstanding (in flight, or frozen after its OWN failure) must never display, nor lose,
// its own state because the OTHER flow was opened in between — a genuinely FRESH open of the other flow
// coincidentally resets the shared flag on its own (pre-fix) reset-on-open logic, so the leak only shows
// up on the RETURN to an already-outstanding flow, exactly as it does for plants A/B on pages/index.vue.
describe('PlantDetail — W2: a failure in ONE flow must never leak into the OTHER flow\'s modal (cross-flow, same plant)', () => {
  function deferred<T>() {
    let resolve!: (v: T) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
  }

  const repotPlant = () => ({
    ...basePlant(),
    profile: { potSizeCm: 20, soilMix: 'potting-mix' },
  });

  const repotCare = {
    plantId: 'p1',
    tasks: [{ task: 'REPOT', status: 'today', daysUntilDue: 0, pendingEvaluation: null }],
  };

  const repotStubs = {
    ...stubs,
    // The REAL row (spec §5.1) — TaskRow.vue's own AppIcon/Badge/Button children resolve via the
    // file-level `stubs` spread above (AppIcon/Badge/Button entries added for exactly this). `evaluate-btn`/
    // `done-btn` no longer exist as classes; the real row's actions are found by icon
    // (`evaluateButtons`/`doneButtons` below), same convention as `pages/index.test.ts` (Task 2).
    UiTaskRow: TaskRow,
    UiRepotEvaluationModal: {
      props: ['open', 'signs', 'submitting', 'error', 'frozen'],
      emits: ['submit', 'start-over'],
      template:
        '<div class="eval-modal" :data-open="open" :data-frozen="frozen" :data-submitting="submitting" :data-error="error">' +
        '<button class="submit-btn" @click="$emit(\'submit\', { answer: \'no-signs\' })">submit</button>' +
        '</div>',
    },
    UiRepotDoneForm: {
      props: ['open', 'currentPotSizeCm', 'currentSoilMix', 'submitting', 'error', 'frozen'],
      emits: ['confirm', 'start-over', 'update:open'],
      template:
        '<div class="done-form" :data-open="open" :data-frozen="frozen" :data-error="error">' +
        '<button class="confirm-btn" @click="$emit(\'confirm\', { potSizeCm: currentPotSizeCm, soilMix: currentSoilMix, charged: true, occurredOn: \'2026-01-01\' })">confirm</button>' +
        '</div>',
    },
  };

  let submitDeferred: ReturnType<typeof deferred<{ evaluationId: string; verdict: string }>>;
  let submitRepotEvaluationMock: ReturnType<typeof vi.fn>;
  let completeRepotDeferred: ReturnType<typeof deferred<{ ok: true }>>;
  let completeRepotMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    submitDeferred = deferred();
    submitRepotEvaluationMock = vi.fn(async () => submitDeferred.promise);
    completeRepotDeferred = deferred();
    completeRepotMock = vi.fn(async () => completeRepotDeferred.promise);
  });

  async function mountRepot() {
    vi.stubGlobal('useApi', () => ({
      getPlant: async () => repotPlant(),
      getPlantCare: async () => repotCare,
      listPlaces: async () => [],
      getPlantHistory: async () => [],
      getPlantPhotos: async () => [],
      getRepotSigns: async () => ({ signs: [] }),
      getSoilReadings: async () => ({ instruments: [], protocol: null, readings: [] }),
      // Task 6: see the shared `stubApi` helper's identical comment — every `useApi` stub in this file
      // needs this now that PlantDetail.vue reads it unconditionally.
      getOwnerInstruments: async () => ({ available: [], selected: [] as string[] }),
      invalidatePlant: vi.fn(),
      submitRepotEvaluation: submitRepotEvaluationMock,
      completeRepot: completeRepotMock,
    }));
    const PlantDetail = (await import('./PlantDetail.vue')).default;
    const w = mount(
      { components: { PlantDetail }, template: '<Suspense><PlantDetail id="p1" /></Suspense>' },
      { global: { stubs: repotStubs, mocks: { $t: i18n.t, $d: (v: unknown) => String(v) } } },
    );
    await flushPromises();
    return w;
  }

  it('the evaluation flow is STILL genuinely in flight; the Done flow fails; returning to the evaluation ' +
    'modal shows NO error (never Done\'s unrelated failure) and is still submitting', async () => {
    const w = await mountRepot();

    // Evaluation: open + submit, left GENUINELY in flight — never resolved for the rest of this test.
    await evaluateButtons(w)[0]!.trigger('click');
    await flushPromises();
    await w.find('.submit-btn').trigger('click');
    await flushPromises();
    expect(w.find('.eval-modal').attributes('data-submitting')).toBe('true');

    // Done: open + confirm + FAIL.
    await doneButtons(w)[0]!.trigger('click');
    await flushPromises();
    await w.find('.confirm-btn').trigger('click');
    await flushPromises();
    completeRepotDeferred.reject(new Error('lost response'));
    await flushPromises();
    expect(w.find('.done-form').attributes('data-error')).toBeTruthy();

    // Return to the evaluation flow: it is STILL in flight — no error, still submitting, never Done's.
    await evaluateButtons(w)[0]!.trigger('click');
    await flushPromises();
    expect(w.find('.eval-modal').attributes('data-error')).toBeFalsy();
    expect(w.find('.eval-modal').attributes('data-submitting')).toBe('true');
  });

  it('the evaluation flow fails and freezes; the Done form is opened (fresh) and closed unconfirmed; ' +
    'returning to the evaluation modal STILL shows ITS OWN error and its own "start over"', async () => {
    const w = await mountRepot();

    // Evaluation: open + submit + FAIL.
    await evaluateButtons(w)[0]!.trigger('click');
    await flushPromises();
    await w.find('.submit-btn').trigger('click');
    await flushPromises();
    submitDeferred.reject(new Error('lost response'));
    await flushPromises();
    expect(w.find('.eval-modal').attributes('data-error')).toBeTruthy();
    expect(w.find('.eval-modal').attributes('data-frozen')).toBe('true');

    // The owner does NOT choose "start over" — they simply open the Done flow instead (a genuinely fresh,
    // unrelated attempt for this plant).
    await doneButtons(w)[0]!.trigger('click');
    await flushPromises();
    expect(w.find('.done-form').attributes('data-error')).toBeFalsy();
    expect(w.find('.done-form').attributes('data-frozen')).toBe('false');

    // Return to the evaluation flow: its OWN failure must still show, exactly as the owner left it.
    await evaluateButtons(w)[0]!.trigger('click');
    await flushPromises();
    expect(w.find('.eval-modal').attributes('data-error')).toBeTruthy();
    expect(w.find('.eval-modal').attributes('data-frozen')).toBe('true');
  });
});

// Owner request, 2026-08-07: `/plants/:id` keeps a standalone "Done" beside "Time to evaluate", with the
// card's own back-date input. Two things had to hold on this page's side of that, and neither did:
//
//   1. THE OWNER MAY CONTRADICT THE APP. The questionnaire said "not yet, back in N days" and the owner
//      repotted anyway. That completion must NOT name the pending RE-EVALUATE row: the server resolves an
//      `evaluationId` only when it points at an unresolved REPOT verdict and 400s otherwise
//      (`feedback.write-core.ts`), while `completeRepotCore` step 2 SUPERSEDES the RE-EVALUATE row for
//      free, with no id needed. Before this change both renderers attached the pending id unconditionally
//      — safe only because a Done button never rendered while a RE-EVALUATE was pending.
//   2. THE BACK-DATE HAD TO REACH THE REQUEST. Every other task's Done carries `occurredOn` straight
//      through; REPOT detours through the completion form, and the date was being dropped on the floor.
describe('PlantDetail — the standalone REPOT Done (owner request 2026-08-07)', () => {
  type Pending = { id: string; verdict: string; reevaluateOn: string | null } | null;

  const repotPlant = () => ({ ...basePlant(), profile: { potSizeCm: 20, soilMix: 'potting-mix' } });
  // §7A (Task 4): a MIXED-task payload. With a REPOT row alone this fixture could not fail on a wrongly
  // -propped WATER row, which is exactly the gap §7 names. Both rows, so the per-task binding is observable.
  const careWith = (pendingEvaluation: Pending) => ({
    plantId: 'p1',
    tasks: [
      { task: 'REPOT', status: 'today', daysUntilDue: 0, nextDueOn: '2026-08-14', pendingEvaluation },
      { task: 'WATER', status: 'today', daysUntilDue: 0, nextDueOn: '2026-08-14', pendingEvaluation: null },
    ],
  });

  // The REAL row (spec §5.1) — TaskRow.vue's own AppIcon/Badge/Button children resolve via the file-level
  // `stubs` spread above. Actions are found by icon (`doneButtons`/`evaluateButtons`), rows by label
  // (`taskRowFor`), same convention as the rest of this file (Task 2/3).
  const repotStubs = {
    ...stubs,
    UiTaskRow: TaskRow,
    // Task 28: `seedOccurredOn` is what carries the card's back-date INTO the form now (`onRepotDone` sets
    // `doneFormOccurredOn`, passed down as `:seed-occurred-on`); the form's own `confirm` payload is what
    // reaches `onRepotDoneConfirm`. This stub mirrors the real form's default exactly (`seedOccurredOn ||
    // todayYmd()`), so it stays faithful to the widened emit contract Task 25 shipped.
    UiRepotDoneForm: {
      props: ['open', 'currentPotSizeCm', 'currentSoilMix', 'submitting', 'error', 'frozen', 'seedOccurredOn'],
      emits: ['confirm', 'start-over', 'update:open'],
      methods: { todayYmd },
      template:
        '<div class="done-form" :data-open="open">' +
        '<button class="confirm-btn" @click="$emit(\'confirm\', { potSizeCm: currentPotSizeCm, soilMix: currentSoilMix, charged: true, occurredOn: seedOccurredOn || todayYmd() })">confirm</button>' +
        '</div>',
    },
  };

  let completeRepotMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    completeRepotMock = vi.fn(async () => ({ ok: true }));
  });

  async function mountRepot(pendingEvaluation: Pending) {
    vi.stubGlobal('useApi', () => ({
      getPlant: async () => repotPlant(),
      getPlantCare: async () => careWith(pendingEvaluation),
      listPlaces: async () => [],
      getPlantHistory: async () => [],
      getPlantPhotos: async () => [],
      getRepotSigns: async () => ({ signs: [] }),
      getSoilReadings: async () => ({ instruments: [], protocol: null, readings: [] }),
      // Task 6: see the shared `stubApi` helper's identical comment — every `useApi` stub in this file
      // needs this now that PlantDetail.vue reads it unconditionally.
      getOwnerInstruments: async () => ({ available: [], selected: [] as string[] }),
      invalidatePlant: vi.fn(),
      completeRepot: completeRepotMock,
    }));
    const PlantDetail = (await import('./PlantDetail.vue')).default;
    const w = mount(
      { components: { PlantDetail }, template: '<Suspense><PlantDetail id="p1" /></Suspense>' },
      { global: { stubs: repotStubs, mocks: { $t: i18n.t, $d: (v: unknown) => String(v) } } },
    );
    await flushPromises();
    return w;
  }

  async function completeVia(w: Awaited<ReturnType<typeof mountRepot>>, button: { trigger: (e: string) => Promise<void> }) {
    await button.trigger('click');
    await flushPromises();
    await w.find('.confirm-btn').trigger('click');
    await flushPromises();
  }

  it('opts the REPOT row into the standalone Done — the prop the Today page does not pass', async () => {
    const w = await mountRepot(null);
    // REPOT: the questionnaire is on offer AND Done is beside it — that pairing is what the prop buys.
    expect(evaluateButtons(taskRowFor(w, 'REPOT')).length).toBe(1);
    expect(doneButtons(taskRowFor(w, 'REPOT')).length).toBe(1);
  });

  // ⚠️ THIS CASE IS FLIPPED BY SPEC §2.1 (Task 11 of the web plan). Until then it pins today's behaviour:
  // the WATER row on this page is not opted in, so with a survey on offer it shows no Done.
  it('does NOT opt the WATER row in — yet', async () => {
    const w = await mountRepot(null);
    expect(doneButtons(taskRowFor(w, 'WATER')).length).toBe(1); // no instrument in this fixture: canSurvey false
  });

  it('completes with NO evaluationId when nothing is pending — the plain standalone case', async () => {
    const w = await mountRepot(null);
    await completeVia(w, doneButtons(taskRowFor(w, 'REPOT'))[0]!);
    expect(completeRepotMock).toHaveBeenCalledTimes(1);
    expect((completeRepotMock.mock.calls[0]![2] as { evaluationId?: string }).evaluationId).toBeUndefined();
  });

  it('completes with NO evaluationId while a RE-EVALUATE row is pending — the owner repotted anyway, and ' +
    'naming that row would be a 400 from a server that only resolves REPOT verdicts', async () => {
    const w = await mountRepot({ id: 'ev-re', verdict: 'RE-EVALUATE', reevaluateOn: '2026-11-05' });
    await completeVia(w, doneButtons(taskRowFor(w, 'REPOT'))[0]!);
    expect(completeRepotMock).toHaveBeenCalledTimes(1);
    const payload = completeRepotMock.mock.calls[0]![2] as { evaluationId?: string };
    expect(payload.evaluationId).toBeUndefined();
  });

  it('STILL names a pending REPOT verdict — the resolution path is untouched', async () => {
    const w = await mountRepot({ id: 'ev-repot', verdict: 'REPOT', reevaluateOn: null });
    await completeVia(w, doneButtons(taskRowFor(w, 'REPOT'))[0]!);
    expect((completeRepotMock.mock.calls[0]![2] as { evaluationId?: string }).evaluationId).toBe('ev-repot');
  });

  // The deleted stub used to fabricate a SECOND button emitting an injected '2026-08-01' to prove "the
  // card's date reaches the request", and a separate case proved the no-date fallback the same way. The real
  // REPOT card has no such second affordance — its date box is READONLY, always `todayYmd()`
  // (TaskRow.vue:400-409, :141-158) — so both cases now collapse to one and the same assertion (the request
  // date equals `todayYmd()`, proved end to end through the real seed chain: TaskRow's box -> onRepotDone ->
  // doneFormOccurredOn -> UiRepotDoneForm's seedOccurredOn -> the confirm payload). Folded into a single test
  // (fix wave) rather than kept as two identically-asserting cases under different titles — the readonly box
  // makes an owner-typed back-date impossible, so "sends the date shown on the card" and "falls back to
  // today" are no longer two different behaviors to pin.
  it('sends the card\'s own (readonly, always-today) date through to the request', async () => {
    const w = await mountRepot(null);
    await completeVia(w, doneButtons(taskRowFor(w, 'REPOT'))[0]!);
    expect(completeRepotMock.mock.calls[0]![1]).toBe(todayYmd());
  });
});

// FIX D1 (independent review of the 2026-08-07 wave, finding 1). `onRepotDone` gated its "this is a resume,
// re-read nothing" early return on the WEAKER question "is a key outstanding?" (`hasKeyFor`), while
// `begin()` decides resume-vs-fresh with "is the outstanding attempt still authoritative?"
// (`error !== 'invalid'`). The two disagree after a 400 — and a 400 is exactly the state the form unfreezes
// in, inviting the owner to correct the value. So: correct the pot size AND the date, press Done again, and
// the early return fired, `doneFormOccurredOn` kept the PRE-rejection date, and `begin()` (which does NOT
// resume an invalid attempt) minted a fresh key over a body built from that stale ref. The repot was written
// on the wrong day — and `completeRepotCore` anchors `substrate_refreshed_on` to that same day, so the
// substrate clock stayed wrong.
//
// Both directions are pinned here, because the fix must not over-correct: after a 400 the reopen is FRESH
// (new date honoured, new key), and after ANY other failure kind it is still a RESUME (byte-identical body,
// same key) — an idempotency key frozen against a body that can still change is a permanent 422.
describe('PlantDetail — FIX D1: after a 400, the reopened Done form must send the CORRECTED back-date', () => {
  const repotPlant = () => ({ ...basePlant(), profile: { potSizeCm: 20, soilMix: 'potting-mix' } });
  const repotCare = {
    plantId: 'p1',
    tasks: [{ task: 'REPOT', status: 'today', daysUntilDue: 0, pendingEvaluation: null }],
  };

  // Task 4: the REAL REPOT card's date box is READONLY, always `todayYmd()` (TaskRow.vue:400-409, :141-158)
  // — a real owner cannot type a different date INTO THE CARD at all, so the two dated `done-aug1`/
  // `done-aug5` buttons this stub used to fabricate cannot exist any more. The genuinely editable date
  // surface for a repot completion is the FORM's own `occurredOn` field (`RepotDoneForm.vue:119,181,267`),
  // so this stub is widened to mirror that field faithfully: an `<input type="date">` seeded from
  // `seedOccurredOn` on a FRESH open and from `frozenSnapshot.occurredOn` on a FROZEN resume (the real
  // component's own `watch(open, ...)`), editable only while not frozen. "Reopening with a NEW date" is now
  // exercised by typing into THIS input, exactly where the real UI puts that editable surface.
  // `defineComponent`, not a plain object literal — this stub's `watch` reads `this.frozen`/
  // `this.frozenSnapshot`/`this.seedOccurredOn`, and only `defineComponent` gives TypeScript the Options
  // API's own `this` inference for `props`/`data`/`methods` (same technique `AgentChat.test.ts` already
  // uses for its own stateful stubs).
  const RepotDoneFormStub = defineComponent({
    props: [
      'open', 'currentPotSizeCm', 'currentSoilMix', 'submitting', 'error', 'frozen', 'frozenSnapshot',
      'seedOccurredOn',
    ],
    emits: ['confirm', 'start-over', 'update:open'],
    data() {
      return { occurredOn: '' };
    },
    methods: { todayYmd },
    watch: {
      // Mirrors RepotDoneForm.vue's own `watch(open, ...)`: a frozen resume hydrates from the outstanding
      // attempt's own stored envelope (never `seedOccurredOn`/`todayYmd()`); a fresh open seeds from the
      // card's own back-date, falling back to today.
      open(isOpen: boolean) {
        if (!isOpen) return;
        this.occurredOn = this.frozen && this.frozenSnapshot
          ? this.frozenSnapshot.occurredOn
          : (this.seedOccurredOn || this.todayYmd());
      },
    },
    template:
      '<div class="done-form" :data-open="open" :data-frozen="frozen">' +
      '<input class="occurred-on-input" type="date" v-model="occurredOn" :disabled="frozen" />' +
      '<button class="confirm-btn" @click="$emit(\'confirm\', { potSizeCm: 26, soilMix: currentSoilMix, charged: true, occurredOn })">confirm</button>' +
      // The REAL v-model:open contract (X/Escape/backdrop) — the owner dismissing the form to reopen it.
      '<button class="close-btn" @click="$emit(\'update:open\', false)">close</button>' +
      '</div>',
  });

  const repotStubs = {
    ...stubs,
    UiTaskRow: TaskRow,
    UiRepotDoneForm: RepotDoneFormStub,
  };

  let completeRepotMock: ReturnType<typeof vi.fn>;

  async function mountRepot(firstFailure: unknown) {
    let call = 0;
    completeRepotMock = vi.fn(async () => {
      if (call++ === 0) throw firstFailure;
      return { ok: true };
    });
    vi.stubGlobal('useApi', () => ({
      getPlant: async () => repotPlant(),
      getPlantCare: async () => repotCare,
      listPlaces: async () => [],
      getPlantHistory: async () => [],
      getPlantPhotos: async () => [],
      getRepotSigns: async () => ({ signs: [] }),
      getSoilReadings: async () => ({ instruments: [], protocol: null, readings: [] }),
      // Task 6: see the shared `stubApi` helper's identical comment — every `useApi` stub in this file
      // needs this now that PlantDetail.vue reads it unconditionally.
      getOwnerInstruments: async () => ({ available: [], selected: [] as string[] }),
      invalidatePlant: vi.fn(),
      completeRepot: completeRepotMock,
    }));
    const PlantDetail = (await import('./PlantDetail.vue')).default;
    const w = mount(
      { components: { PlantDetail }, template: '<Suspense><PlantDetail id="p1" /></Suspense>' },
      { global: { stubs: repotStubs, mocks: { $t: i18n.t, $d: (v: unknown) => String(v) } } },
    );
    await flushPromises();
    return w;
  }

  async function press(w: Awaited<ReturnType<typeof mountRepot>>, selector: string) {
    await w.find(selector).trigger('click');
    await flushPromises();
  }

  it('a 400 unfreezes the form, and reopening it with a NEW date typed on the form sends that new date ' +
    'under a FRESH key — never the date the rejected attempt carried', async () => {
    // A 400 is what an over-max / decimal pot size actually produces (see `classifyRepotFailure`).
    const w = await mountRepot(Object.assign(new Error('pot size out of range'), { statusCode: 400 }));

    await doneButtons(taskRowFor(w, 'REPOT'))[0]!.trigger('click');
    await flushPromises();
    await w.find('.occurred-on-input').setValue('2026-08-01');
    const seededDate = '2026-08-01';
    await press(w, '.confirm-btn');
    expect(completeRepotMock).toHaveBeenCalledTimes(1);
    expect(completeRepotMock.mock.calls[0]![1]).toBe(seededDate);
    // The 400 unfreezes: the owner is being invited to correct the value.
    expect(w.find('.done-form').attributes('data-frozen')).toBe('false');

    // The form's own date field is what's editable — not the (readonly) card — so correcting it means
    // dismissing the form, reopening it, and typing a DIFFERENT date directly into that field.
    await press(w, '.close-btn');
    await doneButtons(taskRowFor(w, 'REPOT'))[0]!.trigger('click');
    await flushPromises();
    expect(w.find('.done-form').attributes('data-open')).toBe('true');
    expect(w.find('.done-form').attributes('data-frozen')).toBe('false'); // fresh, not resumed
    await w.find('.occurred-on-input').setValue('2026-08-05');

    await press(w, '.confirm-btn');
    expect(completeRepotMock).toHaveBeenCalledTimes(2);
    expect(completeRepotMock.mock.calls[1]![1]).toBe('2026-08-05');
    // ...and under a genuinely new key, since the server committed nothing under the rejected one.
    expect(completeRepotMock.mock.calls[1]![3]).not.toBe(completeRepotMock.mock.calls[0]![3]);
  });

  it('every OTHER failure kind still RESUMES byte-identically — the form reopens FROZEN, its date field ' +
    'disabled and hydrated from the outstanding attempt\'s own snapshot, and the retry resends the ' +
    'ORIGINAL date under the ORIGINAL key, or the idempotency layer would 422 that key forever', async () => {
    const w = await mountRepot(new Error('lost response')); // no status -> 'unknown'

    await doneButtons(taskRowFor(w, 'REPOT'))[0]!.trigger('click');
    await flushPromises();
    await w.find('.occurred-on-input').setValue('2026-08-01');
    const seededDate = '2026-08-01';
    await press(w, '.confirm-btn');
    expect(completeRepotMock.mock.calls[0]![1]).toBe(seededDate);
    expect(w.find('.done-form').attributes('data-frozen')).toBe('true');

    await press(w, '.close-btn');
    await doneButtons(taskRowFor(w, 'REPOT'))[0]!.trigger('click'); // resumes — frozen stays true
    await flushPromises();
    expect(w.find('.done-form').attributes('data-frozen')).toBe('true');
    // Hydrated from the frozen snapshot, unchanged, AND disabled — there is no way to retype it.
    expect((w.find('.occurred-on-input').element as HTMLInputElement).value).toBe(seededDate);
    expect(w.find('.occurred-on-input').attributes('disabled')).toBeDefined();

    await press(w, '.confirm-btn');
    expect(completeRepotMock).toHaveBeenCalledTimes(2);
    expect(completeRepotMock.mock.calls[1]![1]).toBe(seededDate);
    expect(completeRepotMock.mock.calls[1]![3]).toBe(completeRepotMock.mock.calls[0]![3]);
  });
});

// The other half of the 2026-08-07 change, on THIS renderer: the verdict modal cannot name a corroborating
// sign unless the ids the owner ticked actually reach it. pages/index.vue carries the identical line, and a
// change landing on one of these two files and not the other is this pair's recurring failure.
describe('PlantDetail — the ticked sign ids reach the verdict modal', () => {
  const repotPlant = () => ({ ...basePlant(), profile: { potSizeCm: 20, soilMix: 'potting-mix' } });
  const repotCare = {
    plantId: 'p1',
    tasks: [{ task: 'REPOT', status: 'today', daysUntilDue: 0, pendingEvaluation: null }],
  };
  const catalogue = [
    { id: 's1', label: 'one', help: null, evidence: 'strong' },
    { id: 's2', label: 'two', help: null, evidence: 'ambiguous' },
  ];

  const repotStubs = {
    ...stubs,
    UiTaskRow: TaskRow,
    UiRepotEvaluationModal: {
      props: ['open', 'signs'],
      emits: ['submit'],
      template:
        '<div class="eval-modal" :data-open="open">' +
        '<button class="submit-signs-btn" @click="$emit(\'submit\', { answer: \'signs\', signIds: [\'s1\'] })">go</button>' +
        '</div>',
    },
    UiRepotVerdictModal: {
      props: ['open', 'result', 'signs', 'checkedSignIds'],
      template:
        '<div class="verdict-modal" :data-open="open" ' +
        ':data-checked="checkedSignIds && checkedSignIds.join(\',\')" :data-signs="signs && signs.length" />',
    },
  };

  it('forwards the submitted signIds and the fetched catalogue after a checked-signs submit', async () => {
    vi.stubGlobal('useApi', () => ({
      getPlant: async () => repotPlant(),
      getPlantCare: async () => repotCare,
      listPlaces: async () => [],
      getPlantHistory: async () => [],
      getPlantPhotos: async () => [],
      getRepotSigns: async () => ({ signs: catalogue, typicalIntervalMonths: null }),
      getSoilReadings: async () => ({ instruments: [], protocol: null, readings: [] }),
      // Task 6: see the shared `stubApi` helper's identical comment — every `useApi` stub in this file
      // needs this now that PlantDetail.vue reads it unconditionally.
      getOwnerInstruments: async () => ({ available: [], selected: [] as string[] }),
      invalidatePlant: vi.fn(),
      submitRepotEvaluation: async () => ({ evaluationId: 'ev-1', verdict: 'RE-EVALUATE', reevaluateOn: '2026-11-05' }),
    }));
    const PlantDetail = (await import('./PlantDetail.vue')).default;
    const w = mount(
      { components: { PlantDetail }, template: '<Suspense><PlantDetail id="p1" /></Suspense>' },
      { global: { stubs: repotStubs, mocks: { $t: i18n.t, $d: (v: unknown) => String(v) } } },
    );
    await flushPromises();

    await evaluateButtons(taskRowFor(w, 'REPOT'))[0]!.trigger('click');
    await flushPromises();
    await w.find('.submit-signs-btn').trigger('click');
    await flushPromises();

    const modal = w.find('.verdict-modal');
    expect(modal.attributes('data-open')).toBe('true');
    expect(modal.attributes('data-checked')).toBe('s1');
    expect(modal.attributes('data-signs')).toBe('2');
  });
});

// Task 28 — the integration point for A1 (the FERTILIZE override explanation, `fertilizeExplanation.ts`,
// Task 24), A3's repot-form date seed (`doneFormOccurredOn` -> `seed-occurred-on`, Task 25/26), and A3's
// soil-mix-changed affordance (`PlantProfileModal`'s widened `saved` emit, Task 27). Each of those pieces
// already has its own dedicated unit test; this file's job is proving PlantDetail.vue actually WIRES them
// together, since it is the only place all three meet.
describe('PlantDetail — Task 28: the FERTILIZE explanation, the repot form\'s date seed, and the soil-mix-changed affordance', () => {
  const repotPlant = () => ({ ...basePlant(), profile: { potSizeCm: 20, soilMix: 'potting-mix' } });

  // QA finding F10 — A3's affordance is DERIVED FROM SERVER STATE now, so the fixture has to model the
  // server rather than the component's memory: this stands in for `plants.substrate_mix_change_pending`,
  // which `updateProfileCore` raises on a real mix change and `refreshSubstrateCore` clears on a real
  // repot. Every `getPlantCare` call reads it live, exactly as a real `refresh()` would.
  let serverMixChangePending = false;

  function careWith(fertilize: { overrideOn: string | null; overrideMovedBy: Array<'FLOOR' | 'SNAP'> }) {
    return {
      plantId: 'p1',
      tasks: [
        { task: 'FERTILIZE', status: 'today', daysUntilDue: 0, pendingEvaluation: null },
        { task: 'REPOT', status: 'today', daysUntilDue: 0, pendingEvaluation: null },
      ],
      fertilize,
      substrate: { mixChangePending: serverMixChangePending },
    };
  }

  // PlantProfileModal's real `saved` emit (Task 27) — two buttons stand in for the two outcomes `save()`
  // reports (an actual mix change vs. a save that left it untouched).
  const PlantProfileModalStub = {
    props: ['modelValue', 'plantId'],
    emits: ['update:modelValue', 'saved'],
    template:
      '<div v-if="modelValue" class="profile-modal">' +
      // `saveChanged` mirrors the REAL save: it writes the server-side pending flag (which the API's
      // `updateProfileCore` does inside the same request) and THEN reports the change to the page, so the
      // page's own `refresh()` reads the flag back rather than inventing it.
      '<button class="save-changed-btn" @click="$emit(\'saved\', { soilMixChanged: true })">save (changed)</button>' +
      '<button class="save-unchanged-btn" @click="$emit(\'saved\', { soilMixChanged: false })">save (unchanged)</button>' +
      '</div>',
  };
  const UiRepotDoneFormStub = {
    props: ['open', 'currentPotSizeCm', 'currentSoilMix', 'submitting', 'error', 'frozen', 'seedOccurredOn'],
    emits: ['confirm', 'start-over', 'update:open'],
    methods: { todayYmd },
    template:
      '<div class="done-form" :data-open="open" :data-seed="seedOccurredOn">' +
      '<button class="confirm-btn" @click="$emit(\'confirm\', { potSizeCm: currentPotSizeCm, soilMix: currentSoilMix, ' +
      'charged: true, occurredOn: seedOccurredOn || todayYmd() })">confirm</button>' +
      '<button class="close-btn" @click="$emit(\'update:open\', false)">close</button>' +
      '</div>',
  };
  // The real component (never stubbed to `true`) — this describe block's whole point is that its `title`/
  // `description`/default-slot buttons actually reach the owner, which an auto-stub would swallow.
  const UiAlertStub = {
    props: ['color', 'title', 'description'],
    template:
      '<div class="stub-alert" :data-color="color">' +
      '<span class="alert-title">{{ title }}</span><span class="alert-desc">{{ description }}</span>' +
      '<slot />' +
      '</div>',
  };

  const localStubs = {
    ...stubs,
    UiTaskRow: TaskRow,
    PlantProfileModal: PlantProfileModalStub,
    UiRepotDoneForm: UiRepotDoneFormStub,
    UiAlert: UiAlertStub,
  };

  let completeRepotMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    serverMixChangePending = false;
    // The real server CLEARS the pending flag inside the repot transaction (`refreshSubstrateCore`), so
    // the double does too — otherwise the "affordance disappears" assertion below would be proving
    // nothing about the real system.
    completeRepotMock = vi.fn(async () => { serverMixChangePending = false; return { ok: true }; });
    // A REFRESHING `useAsyncData` double (QA F10). The module-level stub's `refresh` is a no-op, which is
    // fine while every assertion is about the component's own memory — and useless the moment a value is
    // DERIVED FROM SERVER STATE, because the page would never see the state change. This one re-runs the
    // fetcher and republishes, exactly as the real composable does. Same technique as the round-5 V1
    // block above, which swaps in its own stub and restores the default afterwards.
    vi.stubGlobal('useAsyncData', async (_key: string, fn: () => Promise<unknown>) => {
      const data = ref(await fn());
      return { data, refresh: vi.fn(async () => { data.value = await fn(); }) };
    });
  });

  afterEach(() => {
    vi.stubGlobal('useAsyncData', async (_key: string, fn: () => Promise<unknown>) => ({
      data: ref(await fn()),
      refresh: vi.fn(async () => {}),
    }));
  });

  async function mountWith(fertilize: { overrideOn: string | null; overrideMovedBy: Array<'FLOOR' | 'SNAP'> }) {
    vi.stubGlobal('useApi', () => ({
      getPlant: async () => repotPlant(),
      getPlantCare: async () => careWith(fertilize),
      listPlaces: async () => [],
      getPlantHistory: async () => [],
      getPlantPhotos: async () => [],
      getRepotSigns: async () => ({ signs: [] }),
      getSoilReadings: async () => ({ instruments: [], protocol: null, readings: [] }),
      // Task 6: see the shared `stubApi` helper's identical comment — every `useApi` stub in this file
      // needs this now that PlantDetail.vue reads it unconditionally.
      getOwnerInstruments: async () => ({ available: [], selected: [] as string[] }),
      invalidatePlant: vi.fn(),
      completeRepot: completeRepotMock,
    }));
    const PlantDetail = (await import('./PlantDetail.vue')).default;
    const w = mount(
      { components: { PlantDetail }, template: '<Suspense><PlantDetail id="p1" /></Suspense>' },
      { global: { stubs: localStubs, mocks: { $t: i18n.t, $d: (v: unknown) => String(v) } } },
    );
    await flushPromises();
    return w;
  }

  it('renders the FERTILIZE explanation sentence beside the FERTILIZE task', async () => {
    const w = await mountWith({ overrideOn: '2026-08-10', overrideMovedBy: ['FLOOR'] });
    expect(taskRowFor(w, 'FERTILIZE').find('.mp-taskrow__explanation').text())
      .toBe(i18n.t('taskInfo.substrate.fertilizeOverrideFloor'));
  });

  it('renders BOTH fertilize sentences when both causes acted', async () => {
    // Listed SNAP-then-FLOOR in the payload — the util sorts FLOOR (the cause) before SNAP (the
    // consequence) regardless of wire order, so this also pins that ordering through the real component.
    const w = await mountWith({ overrideOn: '2026-08-10', overrideMovedBy: ['SNAP', 'FLOOR'] });
    expect(taskRowFor(w, 'FERTILIZE').find('.mp-taskrow__explanation').text()).toBe(
      `${i18n.t('taskInfo.substrate.fertilizeOverrideFloor')} ${i18n.t('taskInfo.substrate.fertilizeOverrideSnap')}`,
    );
  });

  // Diagnosed (Task 4, spec §7): this case failed once in a 40-repeat loop and passed 12/12 immediately
  // after, i.e. a genuine flake, not a fluke. Fixed with a second `flushPromises()`, expressed as an await
  // (never a `setTimeout`/retry/`vi.waitFor` masking it). NOTE (fix wave, corrected): the previous version of
  // this comment attributed the extra tick to "the click handler's own `await api.getPlant(...)` inside
  // `onRepotDone`'s resume check" — that is false. `onRepotDone` (`PlantDetail.vue:1018-1056`) is not even
  // `async`, and its own comment at `:1029-1031` says plainly "there is no fallible fetch here"; `onDone`
  // (`PlantDetail.vue:1208`) and `TaskRow.vue`'s own `onDone` (`components/ui/TaskRow.vue:356`) are both
  // synchronous too, so the whole click-to-open chain has no `await` in it anywhere. Re-running this single
  // case in isolation 15/15 times with only ONE `flushPromises()` never reproduced the original flake, so the
  // second tick is precautionary against a re-render race that only showed up once, running inside the full
  // file (shared module-level fixtures/timers across `describe` blocks), not evidence of a real second
  // microtask this component schedules. Also: the plan's own `--repeat 40` verification loop is not runnable
  // as written — vitest 3.2.7 (see `package.json`) has no `--repeat` flag.
  // Expected-value note (unrelated to the above): it also changes from the deleted stub's injected
  // `'2026-08-01'` to `todayYmd()` — the real REPOT card's own (readonly) seed — a consequence of Step 1's
  // stub retirement, not a weakening: the assertion now reads a value the component produced rather than one
  // the test injected.
  it('passes the card\'s shown date into the repot form as its seed', async () => {
    const w = await mountWith({ overrideOn: null, overrideMovedBy: [] });
    await doneButtons(taskRowFor(w, 'REPOT'))[0]!.trigger('click');
    await flushPromises();
    await flushPromises(); // precautionary second tick — see the note above; not a real second await
    expect(w.find('.done-form').attributes('data-seed')).toBe(todayYmd());
  });

  it('opens the repot form automatically when the profile save reports a soil-mix change', async () => {
    const w = await mountWith({ overrideOn: null, overrideMovedBy: [] });
    await findButtonByText(w, 'Add missing info').trigger('click');
    await flushPromises();
    serverMixChangePending = true; // the real save wrote it; the page's refresh() reads it back
    await w.find('.save-changed-btn').trigger('click');
    await flushPromises();

    expect(w.find('.done-form').attributes('data-open')).toBe('true');
    expect(w.find('.stub-alert').exists()).toBe(true);
  });

  it('does NOT open it when the profile was saved without changing the mix', async () => {
    const w = await mountWith({ overrideOn: null, overrideMovedBy: [] });
    await findButtonByText(w, 'Add missing info').trigger('click');
    await flushPromises();
    await w.find('.save-unchanged-btn').trigger('click');
    await flushPromises();

    expect(w.find('.done-form').attributes('data-open')).toBe('false');
    expect(w.find('.stub-alert').exists()).toBe(false);
  });

  it('keeps a persistent affordance after the form is dismissed — the fertilize clock still needs a date', async () => {
    const w = await mountWith({ overrideOn: null, overrideMovedBy: [] });
    await findButtonByText(w, 'Add missing info').trigger('click');
    await flushPromises();
    serverMixChangePending = true; // the real save wrote it; the page's refresh() reads it back
    await w.find('.save-changed-btn').trigger('click');
    await flushPromises();
    expect(w.find('.stub-alert').exists()).toBe(true);

    // Dismiss the form via its own v-model:open contract (X/Escape/backdrop) WITHOUT confirming — the
    // affordance must survive this, because dismissing the modal never answered the question it asks.
    await w.find('.close-btn').trigger('click');
    await flushPromises();

    expect(w.find('.done-form').attributes('data-open')).toBe('false');
    expect(w.find('.stub-alert').exists()).toBe(true);
  });

  // ⚠️ THE F10 REGRESSION, and the one case the old implementation could never pass: a fresh mount with no
  // interaction at all. This IS a reload — the component starts with empty memory and must still speak,
  // because the CONDITION lives on the server, not in this page's head.
  it('renders the affordance on a FRESH MOUNT when the server still says the mix change is unanswered', async () => {
    serverMixChangePending = true;
    const w = await mountWith({ overrideOn: null, overrideMovedBy: [] });
    expect(w.find('.stub-alert').exists()).toBe(true);
    expect(w.find('.alert-title').text()).toBe(i18n.t('soilMixChanged.title'));
    // …and it does NOT open the repot form on its own: a reload is not a save, and hijacking the page with
    // a modal nobody asked for would be a different defect.
    expect(w.find('.done-form').attributes('data-open')).toBe('false');
  });

  it('stays silent on a fresh mount when the server says there is nothing pending', async () => {
    serverMixChangePending = false;
    const w = await mountWith({ overrideOn: null, overrideMovedBy: [] });
    expect(w.find('.stub-alert').exists()).toBe(false);
  });

  it('"Not now" silences it for THIS session, and a reload honestly asks again', async () => {
    serverMixChangePending = true;
    const w = await mountWith({ overrideOn: null, overrideMovedBy: [] });
    await findButtonByText(w, 'Not now').trigger('click');
    await flushPromises();
    expect(w.find('.stub-alert').exists()).toBe(false);

    // The reload. Nothing was answered, so the question comes back — the state is still true.
    const reloaded = await mountWith({ overrideOn: null, overrideMovedBy: [] });
    expect(reloaded.find('.stub-alert').exists()).toBe(true);
  });

  it('a LATER mix change is never born already dismissed', async () => {
    serverMixChangePending = true;
    const w = await mountWith({ overrideOn: null, overrideMovedBy: [] });
    await findButtonByText(w, 'Not now').trigger('click');
    await flushPromises();
    expect(w.find('.stub-alert').exists()).toBe(false);

    await findButtonByText(w, 'Add missing info').trigger('click');
    await flushPromises();
    await w.find('.save-changed-btn').trigger('click');
    await flushPromises();
    expect(w.find('.stub-alert').exists()).toBe(true);
  });

  it('the affordance disappears once a repot is recorded', async () => {
    const w = await mountWith({ overrideOn: null, overrideMovedBy: [] });
    await findButtonByText(w, 'Add missing info').trigger('click');
    await flushPromises();
    serverMixChangePending = true; // the real save wrote it; the page's refresh() reads it back
    await w.find('.save-changed-btn').trigger('click');
    await flushPromises();
    expect(w.find('.stub-alert').exists()).toBe(true);

    await w.find('.confirm-btn').trigger('click');
    await flushPromises();

    expect(completeRepotMock).toHaveBeenCalledTimes(1);
    expect(w.find('.stub-alert').exists()).toBe(false);
  });
});

// Fix wave 1, item 2: a WATER_NOW/POSTPONE verdict on a measurement writes a real DONE/POSTPONED care
// event in the SAME transaction as the reading, and a DONE care event renders in the History timeline —
// the exact reasoning `sendDone`'s own comment already states for the standalone Done paths ("A completed
// action becomes a history item … so refresh the timeline in place too"). `onReadingSaved` used to run
// only `Promise.all([refresh(), refreshReadings()])`, leaving History stale until a manual reload.
describe('PlantDetail — a saved measurement also refreshes History (fix wave 1, item 2)', () => {
  const careRefresh = vi.fn(async () => {});
  const readingsRefresh = vi.fn(async () => {});
  const historyRefresh = vi.fn(async () => {});

  beforeEach(() => {
    careRefresh.mockClear();
    readingsRefresh.mockClear();
    historyRefresh.mockClear();
    // A controllable, KEY-DISTINGUISHED `refresh()` per essential read — same technique the round-5 V1
    // suite above uses for its own `care-` key, extended here to also distinguish `soil-readings-`.
    vi.stubGlobal('useAsyncData', async (key: string, fn: () => Promise<unknown>) => ({
      data: ref(await fn()),
      refresh:
        key.startsWith('care-') ? careRefresh
        : key.startsWith('soil-readings-') ? readingsRefresh
        : vi.fn(async () => {}),
    }));
    // Same technique for the deferred (`{ server: false }`) reads, so `history-${id}`'s own `refresh()`
    // is individually observable too.
    vi.stubGlobal('useLazyAsyncData', (key: string, fn: () => Promise<unknown>) => {
      const data = ref<unknown>(null);
      void Promise.resolve(fn()).then((v) => { data.value = v; });
      return { data, refresh: key.startsWith('history-') ? historyRefresh : vi.fn(async () => {}) };
    });
  });

  afterEach(() => {
    // Restore the module's default (non-instrumented) stubs for every other describe block in this file.
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

  // The base `stubs` map collapses `UiSoilReadingModal` to `true` (an inert unknown element) — this test
  // needs to fire its `@saved` event, so it swaps in a minimal interactive stub instead, everything else
  // unchanged.
  const soilReadingModalStub = {
    props: ['open', 'plantId', 'data'],
    emits: ['saved'],
    template: '<button class="reading-saved-btn" @click="$emit(\'saved\')" />',
  };
  // The base map stubs UiTaskRow inert; this block needs to fire its real `done` event for the WATER row,
  // which is what reaches `sendDone`.
  const taskRowStub = {
    props: ['task', 'status', 'nextDueOn', 'daysUntilDue', 'pendingVerdict', 'suggestMeasuring'],
    emits: ['done'],
    template: '<button :class="`done-btn-${task}`" @click="$emit(\'done\', { task })" />',
  };

  async function mountDetailForReading(plant: ReturnType<typeof basePlant>, care: unknown = null) {
    stubApi(plant);
    if (care !== null) {
      // The shared `stubApi` returns a null care payload (no task rows). The WATER-done case below needs a
      // real WATER row to click, so layer that one field over the shared stub rather than forking it.
      const base = (globalThis as unknown as { useApi: () => Record<string, unknown> }).useApi();
      // `sendFeedback` is absent from the shared stub (no test in it marks a task done), and without it
      // `sendDone` would throw before ever reaching its refresh batch — which would make this test pass
      // for the wrong reason if it asserted the negative.
      vi.stubGlobal('useApi', () => ({
        ...base, getPlantCare: async () => care, sendFeedback: vi.fn(async () => ({})),
      }));
    }
    const PlantDetail = (await import('./PlantDetail.vue')).default;
    const w = mount(
      { components: { PlantDetail }, template: '<Suspense><PlantDetail id="p1" /></Suspense>' },
      {
        global: {
          stubs: { ...stubs, UiSoilReadingModal: soilReadingModalStub, UiTaskRow: taskRowStub },
          mocks: { $t: i18n.t, $d: (v: unknown) => String(v) },
        },
      },
    );
    await flushPromises();
    return w;
  }

  it('calls refresh(), refreshReadings(), AND refreshHistory() when the modal emits saved', async () => {
    const w = await mountDetailForReading(basePlant());

    expect(careRefresh).not.toHaveBeenCalled();
    expect(readingsRefresh).not.toHaveBeenCalled();
    expect(historyRefresh).not.toHaveBeenCalled();

    await w.find('.reading-saved-btn').trigger('click');
    await flushPromises();

    expect(careRefresh).toHaveBeenCalled();
    expect(readingsRefresh).toHaveBeenCalled();
    expect(historyRefresh).toHaveBeenCalled();
  });

  // Round-5 finding F1, the PRIMARY half. `readings.wateringDays` is what tells the measuring modal whether
  // a day carries the same-day question at all, and it is a SNAPSHOT taken at page load. Watering here and
  // then measuring is the owner's own flow for the saturated anchor (spec §4.6 names it: ask when a WATER
  // DONE exists on that date "OR THE OWNER RECORDS A WATERING IN THE SAME SESSION"), so a `sendDone` that
  // does not refresh readings leaves that list stale: the question is never rendered, no answer is sent,
  // and the API's honest 400 reaches the owner as a generic "save failed" they cannot clear without
  // reloading. The short-cycle plant the whole ruling was made for is exactly the one that hits it.
  it('marking WATER done ALSO refreshes readings — otherwise the same-day question never appears', async () => {
    const w = await mountDetailForReading(basePlant(), {
      tasks: [{ task: 'WATER', nextDueOn: '2026-08-08', daysUntilDue: 0, status: 'due', pendingEvaluation: null }],
      viability: null, soilDrynessBeforeWatering: 'half-dry', crowding: null, juvenile: null,
      substrate: null, measurement: null, fertilize: { overrideOn: null, overrideMovedBy: [] },
    });
    expect(readingsRefresh).not.toHaveBeenCalled();

    await w.find('.done-btn-WATER').trigger('click');
    await flushPromises();

    expect(readingsRefresh).toHaveBeenCalled();
    // The pre-existing refreshes must survive the addition.
    expect(careRefresh).toHaveBeenCalled();
    expect(historyRefresh).toHaveBeenCalled();
  });
});

// Task 6 (watering-survey-web plan): the WATER row joins the survey shape pages/index.vue's own WATER row
// already has (commit ff75f51) — "Do you need to water?" before "Done" — and ADDITIONALLY keeps
// `allowStandaloneDone`, REPOT's own precedent on this page (see the `describe` block above), so "I
// watered it two days ago" stays expressible. The voluntary reading ("Add a reading") moves OUT of the
// task row — the `@measure` binding is gone — and into the measurement-history block below the task-rows
// card, which is the SAME block that already hosted the two drying-rate findings (Task 28).
describe('PlantDetail — Task 6: the plant page surveys too, and the voluntary reading moves to the history', () => {
  // measured-verdict-gap spec (Task 47/T6b) — the verdict defaults to `null` (nothing measured), so
  // every PRE-EXISTING test in this block keeps describing a plant nobody has surveyed yet, unchanged.
  //
  // ⚠️ `measuredToday` IS DERIVED HERE, NEVER SET INDEPENDENTLY (QA finding F1, 2026-08-10). The API
  // derives it from the verdict for exactly this reason, and a fixture free to set the two separately is
  // a fixture free to describe a payload the server cannot produce — a measured day with no verdict, or a
  // verdict on a day nothing was measured. That is the "hand-built fixture is a CLAIM about the wire"
  // trap this repo has already been bitten by; deriving it makes the claim true by construction.
  //
  // ⚠️ `watering` IS A SIBLING OF `measurement`, AND ITS TWO FIELDS ARE DERIVED THE WAY THE API DERIVES
  // THEM (QA round 3, F1/F1b). `promptAnsweredToday` is FORCED false when nothing was measured: the API
  // skips that query entirely when there is no deciding reading, so a fixture free to set it beside a null
  // verdict would describe a payload the server cannot produce — a day whose reading was "answered" with no
  // reading on file. `wateredToday` stays genuinely free, because it is genuinely independent: a watering
  // happens on days nobody measured, and a reading happens on days nobody waters.
  const waterCare = (
    todaysVerdict: TodaysVerdict = null,
    { wateredToday = false, promptAnswered = false } = {},
  ) => ({
    plantId: 'p1',
    tasks: [{ task: 'WATER', status: 'today', daysUntilDue: 0, pendingEvaluation: null }],
    measurement: {
      dryingRate: null, reason: null, tooSlowDrying: false, flatSeries: false, suggestMeasuring: false,
      measuredToday: todaysVerdict != null,
      todaysVerdict,
    },
    watering: { wateredToday, promptAnsweredToday: todaysVerdict != null && promptAnswered },
  });

  // ⚠️ NO MORE HAND-WRITTEN `UiTaskRow` STUB HERE (Task 5, spec §5.1). It used to re-derive Done/Postpone/
  // Evaluate visibility from `canSurvey`/`allowStandaloneDone`/`wateredToday` — a second, private copy of
  // `TaskRow.vue`'s own `showEvaluate`/`showDone`/`showPostpone`/`doneWouldBeDiscarded` — and it stayed
  // green through two QA rounds while the real row had no date box to model the back-dating half of the
  // discarded-Done rule at all. `localStubs` below now resolves `UiTaskRow` to the REAL `TaskRow.vue`
  // (imported at the top of this file), so every case in this block reads the row's own rendered DOM
  // through the `taskRowFor`/`doneButtons`/`evaluateButtons`/`postponeButtons` helpers, exactly like the
  // REPOT blocks above (Tasks 2-4).

  // Stands in for the real SoilReadingModal.vue (covered by its own test file) — this describe block's only
  // concern is that PlantDetail.vue opens it in the right MODE from the right entry point. Named explicitly
  // so `findComponent({ name: 'UiSoilReadingModal' })` can locate it, the same technique this file already
  // uses for `UiPlantPhoto` above.
  // `wateredToday` joined the prop list on 2026-08-11 (F1b's second door): the modal withholds **Hecho** on
  // its WATER_NOW verdict for a pot already watered today, and this page is where that fact comes from.
  const UiSoilReadingModalStub = {
    name: 'UiSoilReadingModal',
    props: ['open', 'plantId', 'data', 'mode', 'wateredToday'],
    emits: ['update:open', 'saved'],
    template: '<div class="soil-modal" :data-open="open" :data-mode="mode" />',
  };

  const localStubs = { ...stubs, UiTaskRow: TaskRow, UiSoilReadingModal: UiSoilReadingModalStub };

  async function mountWater(
    selected: string[],
    todaysVerdict: TodaysVerdict = null,
    watering: { wateredToday?: boolean; promptAnswered?: boolean } = {},
  ) {
    vi.stubGlobal('useApi', () => ({
      getPlant: async () => basePlant(),
      getPlantCare: async () => waterCare(todaysVerdict, watering),
      listPlaces: async () => [],
      getPlantHistory: async () => [],
      getPlantPhotos: async () => [],
      getRepotSigns: async () => ({ signs: [] }),
      getSoilReadings: async () => ({
        // QA round 4, DEF-5: the payload carries the plant's acquisition day now. Far in the past here, so
        // it constrains nothing any case in this block is about.
        acquiredOn: '2020-01-01', instruments: [], protocol: null, readings: [], wateringDays: [],
      }),
      getOwnerInstruments: async () => ({ available: [], selected }),
      invalidatePlant: vi.fn(),
    }));
    const PlantDetail = (await import('./PlantDetail.vue')).default;
    const w = mount(
      { components: { PlantDetail }, template: '<Suspense><PlantDetail id="p1" /></Suspense>' },
      { global: { stubs: localStubs, mocks: { $t: i18n.t, $d: (v: unknown) => String(v) } } },
    );
    await flushPromises();
    return w;
  }

  // Mutation proof 1 target: hardcoding `:can-survey="true"` on the WATER binding makes this go RED
  // (the survey would render with zero instruments selected).
  it('a WATER row with no instrument selected keeps today\'s shape', async () => {
    const w = await mountWater([]);
    const row = taskRowFor(w, 'WATER');
    expect(evaluateButtons(row).length).toBe(0);
    expect(doneButtons(row).length).toBe(1);
    expect(postponeButtons(row).length).toBe(1);
  });

  // ⚠️ REWRITTEN 2026-08-11 (QA round 4, DEF-3; owner-ruled). Its old title was "...and keeps standalone
  // Done", and BOTH of its action assertions were the defect, in opposite directions:
  //
  //   • `.postpone-btn` false — an owner with an instrument could not defer a watering at all. That is
  //     DEF-3 proper, and it is now `true`.
  //   • `.done-btn` true — this page passed `allow-standalone-done` unconditionally, so it offered a
  //     Hecho the Today list never did. Two surfaces disagreeing about one row, in the opposite direction
  //     to DEF-3 itself; the owner's ruling settles both halves at once, and it is now `false`.
  //
  // WITH THE SURVEY ON OFFER, A WATER ROW NOW READS THE SAME ON BOTH SURFACES: measure + Posponer, no
  // Hecho. The consequence, recorded rather than discovered: back-dating a watering from this page means
  // taking today's reading first — any reading closes the survey and hands the ordinary Hecho + date box
  // back (the case directly below is exactly that state).
  it('the WATER row offers the survey, keeps Posponer, and withholds Hecho', async () => {
    const w = await mountWater(['galvanic-probe']);
    const row = taskRowFor(w, 'WATER');
    expect(evaluateButtons(row).length).toBe(1);
    // The real button's text is the ACTUAL i18n translation (this file's `useI18n` stub resolves through
    // the real `i18n` instance below `en.json`/`es.json`, unlike the deleted stub's own hardcoded literal).
    expect(evaluateButtons(row)[0]!.text()).toBe(i18n.t('reading.surveyQuestion'));
    expect(doneButtons(row).length).toBe(0);   // ⚠️ FLIPPED BY §2.1 — Task 11
    expect(postponeButtons(row).length).toBe(1);
  });

  // ⚠️ REWRITTEN BY §2.1 IN TASK 11 (the prop becomes true for WATER on this page). Until then this is the
  // DEF-3 guard exactly as it stands, observed on the real row rather than on a stub's data attribute.
  it('DEF-3: the WATER row is not opted into the standalone Done', async () => {
    const w = await mountWater(['galvanic-probe']);
    expect(doneButtons(taskRowFor(w, 'WATER')).length).toBe(0);
  });
  // The REPOT half — that the prop is still passed, and still opts the row in — is pinned in this file's
  // own REPOT blocks above ("...opts the REPOT row into the standalone Done"), which mount a care payload
  // that HAS a REPOT task. Restating it here would need a second fixture for no new information; a change
  // that dropped the prop for REPOT turns those cases red, which is the point.

  // measured-verdict-gap spec (Task 47/T6b), REWRITTEN by QA finding F1 (2026-08-10) — the ground truth is
  // the READING'S VERDICT (`care.measurement.todaysVerdict`), not session memory and not the bare
  // `measuredToday` fact this used to read. Once the survey has answered "water it now", the row must fall
  // back to the classic Done | Postpone pair — the app's ORDINARY task controls, reused rather than
  // rebuilt — exactly as a no-instrument owner sees, even though this owner DOES have an instrument
  // selected. Hardcoding the verdict out of the `canSurveyWater` expression makes this go RED.
  it('withholds the survey once today\'s reading has answered the question, even with an instrument', async () => {
    const w = await mountWater(['galvanic-probe'], 'WATER_NOW');
    const row = taskRowFor(w, 'WATER');
    expect(evaluateButtons(row).length).toBe(0);
    expect(doneButtons(row).length).toBe(1);
    expect(postponeButtons(row).length).toBe(1);
  });

  // ═════════════════════════════════════════════════════════════════════════════════════════════════
  // QA round 3, F1b — THE MEDIR BUTTON WITHDRAWS FOR THE REST OF THE DAY ONCE THE POT IS WATERED.
  //
  // The owner, 2026-08-11, in his own words: *"after marking a Riego task as Done, the Medir button on
  // /plants/:id must disappear; it comes back the next day. And that's fine, because the watering task
  // already measured."* What it prevents: measuring an already-watered pot produced a 200 the API's
  // one-WATER-DONE-per-day dedup then discarded — an action the app accepted and did not record.
  //
  // ⚠️ NOTHING WAS MEASURED IN THIS FIXTURE, and that is the entire point: `todaysVerdict` is null, so
  // no other term in `canOfferWaterSurvey` can withhold the survey here. This is the owner who simply
  // pressed Hecho. Removing `wateredToday` from the `canSurveyWater` expression turns it RED.
  // ═════════════════════════════════════════════════════════════════════════════════════════════════
  it('F1b: withdraws the survey once the pot was watered today, with nothing measured', async () => {
    const w = await mountWater(['galvanic-probe'], null, { wateredToday: true });
    const row = taskRowFor(w, 'WATER');
    expect(evaluateButtons(row).length).toBe(0);
    // ⚠️ REWRITTEN 2026-08-11 (QA round 5, F1). This used to assert that "the ordinary pair is what the row
    // falls back to" — and that fallback WAS the third door onto the discarded-Done defect: with the pot
    // already watered, the Hecho it restored posts an `occurredOn` of today, which the API's
    // one-`WATER DONE`-per-day dedup swallows for a `200` and no change anywhere. Posponer is untouched
    // (DEF-3: "no tengo tiempo ahorita" is an answer about the owner, not the pot, and it is not deduped).
    // ⚠️ AND THIS IS NOW ALSO THE PROOF OF `doneWouldBeDiscarded` (Task 5) — the real row's own date box
    // starts blank, and a blank box means TODAY, so the discarded-note replaces Hecho even though nothing
    // measured today at all withheld it via `canSurvey`. The stub this replaces had no date box and could
    // only ever describe this empty-box case.
    expect(doneButtons(row).length).toBe(0);
    expect(postponeButtons(row).length).toBe(1);
  });

  // THE BEFORE HALF: the SAME owner, the SAME instrument, the SAME un-measured day — only the watering
  // differs. Without it the case above would pass against a page that never offered the survey at all.
  it('F1b: an un-watered pot still offers it', async () => {
    const w = await mountWater(['galvanic-probe'], null, { wateredToday: false });
    expect(evaluateButtons(taskRowFor(w, 'WATER')).length).toBe(1);
  });

  // ⚠️ ITEM 3, OWNER-RULED THE SAME DAY: **ONLY** MEDIR DISAPPEARS. "Agregar lectura" is the free log and
  // the only way to CORRECT the day's reading — one reading per plant per instrument per day means it edits
  // today's row rather than adding a second one — so a watering must not take it away, or a wrong reading
  // stays wrong until tomorrow. Gating the button on `wateredToday` "for consistency" turns this RED.
  it('F1b: the voluntary "Agregar lectura" survives the watering — only Medir withdraws', async () => {
    const w = await mountWater(['galvanic-probe'], null, { wateredToday: true });
    expect(w.findAll('button').some((b) => b.text() === i18n.t('reading.addReading'))).toBe(true);
  });

  // ═════════════════════════════════════════════════════════════════════════════════════════════════
  // …AND BECAUSE IT SURVIVES, THE MODAL HAS TO KNOW (F1b's SECOND DOOR, 2026-08-11).
  //
  // The two cases above are one ruling's two halves: Medir withdraws, the free log stays. The half that
  // stays is a live route back to the very defect Medir's withdrawal closed — correcting a reading that
  // carries an answer re-computes it, and the recompute can earn `WATER_NOW`, whose verdict step offers
  // **Hecho**, whose write the API's one-WATER-DONE-per-day dedup discards. So the modal withholds Hecho
  // itself, and this page is the only place that holds the fact it needs.
  //
  // ⚠️ ASSERTED AS THE PROP THE MODAL RECEIVES, not as a rendered button — the button belongs to
  // `SoilReadingModal.test.ts`, which pins it against the real component. What can only be checked HERE is
  // that the fact travels at all: wiring `:watered-today="canSurveyWater"` (an AND of four conditions) or
  // forgetting the binding entirely turns these RED.
  // ═════════════════════════════════════════════════════════════════════════════════════════════════
  it('F1b: hands the reading dialog the watering fact, so it can withhold Hecho', async () => {
    const w = await mountWater(['galvanic-probe'], null, { wateredToday: true });
    expect(w.findComponent({ name: 'UiSoilReadingModal' }).props('wateredToday')).toBe(true);
  });

  // The other direction, and it is not symmetry for its own sake: a binding hard-coded to `true` — or one
  // that read a always-truthy expression — would silently delete the payoff action of the whole redesign
  // for every ordinary plant.
  it('F1b: and hands it `false` on a pot nobody has watered today', async () => {
    const w = await mountWater(['galvanic-probe'], null, { wateredToday: false });
    expect(w.findComponent({ name: 'UiSoilReadingModal' }).props('wateredToday')).toBe(false);
  });

  // ⚠️ THE ANTI-ALIASING PIN, DIRECTION A: `wateredToday` must not be read off `promptAnsweredToday`.
  // A voluntary reading (verdict `'NONE'`, which decides nothing and keeps the question open) followed by a
  // Posponer answers the day's prompt while watering NOTHING — so the survey must still be on offer. Wiring
  // `wateredToday: care.watering?.promptAnsweredToday` turns this RED; it is the only reachable shape where
  // the two booleans disagree and the survey gate is not already closed by the verdict.
  it('F1b: a postponed — not watered — day keeps the survey on offer', async () => {
    const w = await mountWater(['galvanic-probe'], 'NONE', { wateredToday: false, promptAnswered: true });
    expect(evaluateButtons(taskRowFor(w, 'WATER')).length).toBe(1);
  });

  it('the Measure button is GONE from the task row', async () => {
    const w = await mountWater(['galvanic-probe']);
    // The old affordance's own rendered text (`reading.measureAction`, resolved through the REAL i18n
    // instance this file uses) is nowhere in the row: PlantDetail.vue no longer binds `:suggest-measuring`
    // at all, so the (still-supported) real TaskRow.vue never even considers rendering it.
    expect(taskRowFor(w, 'WATER').text()).not.toContain(i18n.t('reading.measureAction'));
    expect(w.find('.measure-btn').exists()).toBe(false);
  });

  // Mutation proof 3 target: changing `openVoluntaryReading`'s `readingMode.value` assignment from
  // `'voluntary'` to `'survey'` makes this go RED.
  it('a voluntary reading is taken from the measurement history instead', async () => {
    const w = await mountWater(['galvanic-probe']);
    const addBtn = w.findAll('button').find((b) => b.text() === i18n.t('reading.addReading'));
    expect(addBtn).toBeTruthy();

    await addBtn!.trigger('click');
    await flushPromises();

    const modal = w.findComponent({ name: 'UiSoilReadingModal' });
    expect(modal.attributes('data-open')).toBe('true');
    expect(modal.props('mode')).toBe('voluntary');
  });

  // ═════════════════════════════════════════════════════════════════════════════════════════════════
  // OPENING THE DIALOG REFRESHES THE READINGS — AND A FAILED REFRESH MUST NOT BLANK THEM.
  //
  // QA round 3 added the refresh (a plant watered from another tab left this page's snapshot behind, and
  // the survey dead-ended). QA round 5 found what it introduced: `useAsyncData`'s `refresh()` resets
  // `data` to its default on error, so a failed refresh did not leave the snapshot alone — it BLANKED it,
  // and the dialog told an owner with four instruments that he had told us nothing about what he measures
  // with, while the card behind it correctly said the load had failed.
  //
  // The stub below models the REAL failure shape rather than a convenient one: `refresh()` RESOLVES and
  // sets `data` to null. A stub that merely rejected would let a `try/catch`-only fix pass, which is
  // exactly the fix that does not work here.
  // ═════════════════════════════════════════════════════════════════════════════════════════════════
  describe('a failed refresh on open keeps the readings the owner already had', () => {
    const LOADED = {
      instruments: [{ id: 'galvanic-probe', requiresCalibration: false }],
      protocol: null, readings: [], wateringDays: [],
    };

    afterEach(() => {
      vi.stubGlobal('useAsyncData', async (_key: string, fn: () => Promise<unknown>) => ({
        data: ref(await fn()),
        refresh: vi.fn(async () => {}),
      }));
    });

    async function mountWithFailingReadingsRefresh() {
      vi.stubGlobal('useAsyncData', async (key: string, fn: () => Promise<unknown>) => {
        const data = ref(await fn());
        return {
          data,
          refresh: key.startsWith('soil-readings-')
            // Resolves. Blanks. This is what Nuxt does on a failed refresh.
            ? vi.fn(async () => { data.value = null; })
            : vi.fn(async () => {}),
        };
      });
      vi.stubGlobal('useApi', () => ({
        getPlant: async () => basePlant(),
        getPlantCare: async () => waterCare(null),
        listPlaces: async () => [],
        getPlantHistory: async () => [],
        getPlantPhotos: async () => [],
        getRepotSigns: async () => ({ signs: [] }),
        getSoilReadings: async () => LOADED,
        getOwnerInstruments: async () => ({ available: [], selected: ['galvanic-probe'] }),
        invalidatePlant: vi.fn(),
      }));
      const PlantDetail = (await import('./PlantDetail.vue')).default;
      const w = mount(
        { components: { PlantDetail }, template: '<Suspense><PlantDetail id="p1" /></Suspense>' },
        { global: { stubs: localStubs, mocks: { $t: i18n.t, $d: (v: unknown) => String(v) } } },
      );
      await flushPromises();
      return w;
    }

    it('still opens the dialog, carrying the instruments it had a second earlier', async () => {
      const w = await mountWithFailingReadingsRefresh();
      const addBtn = w.findAll('button').find((b) => b.text() === i18n.t('reading.addReading'));
      await addBtn!.trigger('click');
      await flushPromises();

      const modal = w.findComponent({ name: 'UiSoilReadingModal' });
      expect(modal.attributes('data-open')).toBe('true');
      // THE ASSERTION THAT MATTERS. Blanked, this is `[]` and the dialog says "you haven't told us what
      // you measure with yet" to an owner who has.
      expect((modal.props('data') as typeof LOADED).instruments).toHaveLength(1);
    });

    it('leaves the entry point usable afterwards — the guard must not wedge', async () => {
      const w = await mountWithFailingReadingsRefresh();
      const addBtn = () => w.findAll('button').find((b) => b.text() === i18n.t('reading.addReading'));
      await addBtn()!.trigger('click');
      await flushPromises();
      // Close, then open again: a `readingOpening` flag left true by a failing path would make the second
      // open a silent no-op — the same "nothing happened" the guard exists to remove.
      await w.findComponent({ name: 'UiSoilReadingModal' }).vm.$emit('update:open', false);
      await flushPromises();
      await addBtn()!.trigger('click');
      await flushPromises();
      expect(w.findComponent({ name: 'UiSoilReadingModal' }).attributes('data-open')).toBe('true');
    });
  });

  // Not one of the four pinned tests, but the wiring it proves is new production code this task adds
  // (`onEvaluateTask`, routing a WATER row's own survey click to `readingMode: 'survey'` instead of into
  // the REPOT-only `onEvaluate`): unverified, it would ship a WATER "¿Necesitas regar?" click that silently
  // opened the REPOT questionnaire instead of the measuring modal.
  it('the WATER survey click opens the SAME modal in survey mode, not the REPOT questionnaire', async () => {
    const w = await mountWater(['galvanic-probe']);
    await evaluateButtons(taskRowFor(w, 'WATER'))[0]!.trigger('click');
    await flushPromises();

    const modal = w.findComponent({ name: 'UiSoilReadingModal' });
    expect(modal.attributes('data-open')).toBe('true');
    expect(modal.props('mode')).toBe('survey');
  });
});

// FIX W1 + FIX W2 on the plant page — the SAME two rules pages/index.vue carries (see pages/index.test.ts's
// own W1/W2 blocks). Both are stated once in `utils/waterSurvey.ts` and applied twice; this block is what
// proves the SECOND application exists, which is exactly what "one behaviour, both surfaces" needs a test
// for. The plumbing legitimately differs (this page holds ONE plant's catalogue from a page-load
// `useAsyncData`, Today fetches per click), so the two blocks assert the same behaviour through different
// seams.
describe('PlantDetail — W1/W2: the failed catalogue, and the postpone that stops asking', () => {
  // Same derived shape as the Task 6 block above, and for the same reason — see its own comment.
  // `status`/`daysUntilDue` are parameters since 2026-08-11 (QA finding 3): every case in this block used
  // to be `today`, which is precisely the shape that CANNOT exhibit the finding — the measurement override
  // only ever applies to a not-yet-due row.
  // `watering` derived exactly as the Task 6 block above derives it — see that comment for why
  // `promptAnsweredToday` cannot be set beside a null verdict.
  const waterCare = (
    todaysVerdict: TodaysVerdict = null, status = 'today', daysUntilDue = 0,
    { wateredToday = false, promptAnswered = false } = {},
  ) => ({
    plantId: 'p1',
    tasks: [{ task: 'WATER', status, daysUntilDue, pendingEvaluation: null }],
    measurement: {
      dryingRate: null, reason: null, tooSlowDrying: false, flatSeries: false, suggestMeasuring: false,
      measuredToday: todaysVerdict != null,
      todaysVerdict,
    },
    watering: { wateredToday, promptAnsweredToday: todaysVerdict != null && promptAnswered },
  });

  // ⚠️ NO MORE HAND-WRITTEN `UiTaskRow` STUB HERE EITHER (Task 5, spec §5.1) — same argument as the Task 6
  // block above. `localStubs` below resolves `UiTaskRow` to the REAL `TaskRow.vue`; the two prop-binding
  // cases that used to read this stub's `data-prompt-answered`/`data-watered-today` attributes now read the
  // real component's PROPS directly via `w.findComponent(TaskRow).props(...)`, and the two that used to
  // emit `done` on `UiTaskRowStub` now emit it on `w.findComponent(TaskRow)` — the row itself, not a button
  // the real component may not even render for that fixture.
  // The base map collapses UiAlert to `true` (its slot never renders), so the retry button inside the
  // load-failure banner would be unreachable — a real stub that renders its slot AND names which banner
  // it is, the same `data-description` hook pages/index.test.ts uses.
  const UiAlertStub = {
    props: ['color', 'description', 'announce'],
    template: '<div class="detail-alert" :data-description="description"><slot /></div>',
  };
  const UiReasonPickerStub = {
    props: ['open', 'title', 'options', 'confirmLabel'],
    emits: ['update:open', 'confirm'],
    template: '<div class="reason-picker" :data-open="String(!!open)" />',
  };
  const localStubs = {
    ...stubs,
    UiTaskRow: TaskRow,
    UiAlert: UiAlertStub,
    UiReasonPicker: UiReasonPickerStub,
    UiSoilReadingModal: { name: 'UiSoilReadingModal', props: ['open', 'plantId', 'data', 'mode'], template: '<div />' },
  };

  // Typed on its own parameters (rather than inferred from a zero-arg lambda) so `.mock.calls[n]` carries
  // the real `[plantId, body]` tuple — same technique SoilReadingModal.test.ts uses for `recordSoilReading`.
  const sendFeedbackMock = vi.fn(
    async (_plantId: string, _body: Record<string, unknown>) => ({ ok: true }),
  );

  // `readingsFails` drives the ONE thing under test in the W1 half: whether the page HOLDS this plant's
  // instrument catalogue. The `useAsyncData` stub below mirrors Nuxt's real behaviour on a rejected
  // fetcher — the error is captured, `data` stays null — rather than letting the rejection escape and
  // fail the mount, which is precisely the state the component has to survive.
  async function mountWater(
    {
      todaysVerdict = null, readingsFails = false, status = 'today', daysUntilDue = 0,
      wateredToday = false, promptAnswered = false,
    }: {
      todaysVerdict?: TodaysVerdict; readingsFails?: boolean; status?: string; daysUntilDue?: number;
      wateredToday?: boolean; promptAnswered?: boolean;
    } = {},
  ) {
    sendFeedbackMock.mockClear();
    vi.stubGlobal('useAsyncData', async (_key: string, fn: () => Promise<unknown>) => {
      let data: unknown = null;
      try { data = await fn(); } catch { data = null; }
      return { data: ref(data), refresh: vi.fn(async () => {}) };
    });
    vi.stubGlobal('useApi', () => ({
      getPlant: async () => basePlant(),
      getPlantCare: async () => waterCare(todaysVerdict, status, daysUntilDue, { wateredToday, promptAnswered }),
      listPlaces: async () => [],
      getPlantHistory: async () => [],
      getPlantPhotos: async () => [],
      getRepotSigns: async () => ({ signs: [] }),
      getSoilReadings: async () => {
        if (readingsFails) throw new Error('network');
        return { instruments: [{ id: 'galvanic-probe' }], protocol: null, readings: [], wateringDays: [] };
      },
      getOwnerInstruments: async () => ({ available: [], selected: ['galvanic-probe'] }),
      sendFeedback: sendFeedbackMock,
      invalidatePlant: vi.fn(),
    }));
    const PlantDetail = (await import('./PlantDetail.vue')).default;
    const w = mount(
      { components: { PlantDetail }, template: '<Suspense><PlantDetail id="p1" /></Suspense>' },
      { global: { stubs: localStubs, mocks: { $t: i18n.t, $d: (v: unknown) => String(v) } } },
    );
    await flushPromises();
    return w;
  }

  afterEach(() => {
    // Restore the module's default stub for every other describe block in this file.
    vi.stubGlobal('useAsyncData', async (_key: string, fn: () => Promise<unknown>) => ({
      data: ref(await fn()),
      refresh: vi.fn(async () => {}),
    }));
  });

  it('W1: a failed catalogue fetch hands the classic Hecho | Posponer back instead of withholding them',
    async () => {
      const w = await mountWater({ readingsFails: true });
      const row = taskRowFor(w, 'WATER');
      expect(evaluateButtons(row).length).toBe(0);
      expect(doneButtons(row).length).toBe(1);
      expect(postponeButtons(row).length).toBe(1);
    });

  it('W1: says the load failed, and never offers a voluntary reading it could only answer with the ' +
    '"you have no instruments" lie', async () => {
    const w = await mountWater({ readingsFails: true });
    const banner = w.findAll('.detail-alert')
      .find((a) => a.attributes('data-description') === i18n.t('reading.surveyLoadError'));
    expect(banner).toBeTruthy();
    // The retry lives inside it, and it is the only route back to the check.
    expect(banner!.find('button').exists()).toBe(true);
    // "Add a reading" stands down — it opens the SAME modal onto the SAME empty state.
    expect(w.findAll('button').some((b) => b.text() === i18n.t('reading.addReading'))).toBe(false);
  });

  it('W1: a catalogue we DO hold changes neither — the survey is offered and the reading stays addable',
    async () => {
      const w = await mountWater();
      expect(evaluateButtons(taskRowFor(w, 'WATER')).length).toBe(1);
      expect(w.findAll('button').some((b) => b.text() === i18n.t('reading.addReading'))).toBe(true);
      expect(w.findAll('.detail-alert')
        .some((a) => a.attributes('data-description') === i18n.t('reading.surveyLoadError'))).toBe(false);
    });

  it('W2: a postpone after today\'s measurement submits no-time without opening the picker', async () => {
    const w = await mountWater({ todaysVerdict: 'WATER_NOW' });
    await postponeButtons(taskRowFor(w, 'WATER'))[0]!.trigger('click');
    await flushPromises();

    expect(sendFeedbackMock).toHaveBeenCalledTimes(1);
    expect(sendFeedbackMock.mock.calls[0][1]).toMatchObject({
      task: 'WATER', type: 'POSTPONED', reason: 'no-time',
    });
    expect(w.findAll('.reason-picker').every((p) => p.attributes('data-open') === 'false')).toBe(true);
  });

  // ---- QA 2026-08-11, finding 3: the plant page's own half (docs/care-engine.md §7.20.15) -------------
  //
  // The rule lives in `utils/waterSurvey.ts`; the badge/Posponer half is pinned in TaskRow.test.ts. What
  // only THIS file can pin is that the page applies the same rule to the status it hands `onDone`, because
  // that status is what decides whether the early-watering reason picker opens. QA measured the whole
  // failure here: the row read "faltan 9 días", Posponer did not render, and the verdict left no trace.
  it('finding 3: a measured WATER_NOW sends the Done straight through on a not-yet-due watering', async () => {
    const w = await mountWater({ todaysVerdict: 'WATER_NOW', status: 'upcoming', daysUntilDue: 9 });
    await doneButtons(taskRowFor(w, 'WATER'))[0]!.trigger('click');
    await flushPromises();

    expect(sendFeedbackMock).toHaveBeenCalledTimes(1);
    expect(sendFeedbackMock.mock.calls[0][1]).toMatchObject({ task: 'WATER', type: 'DONE' });
    // No "why are you watering early?" about a watering the app itself just prescribed.
    expect(w.findAll('.reason-picker').every((p) => p.attributes('data-open') === 'false')).toBe(true);
  });

  // THE BEFORE HALF — without it the case above would pass against a page that never asked the
  // early-watering question at all, which would silently delete the one signal the engine has about an
  // unmeasured early watering. `readingsFails` is how an un-measured row still offers a Done here at all
  // (with the catalogue held, the survey withholds it — see the W2 case below).
  it('finding 3: still asks on an UNMEASURED not-yet-due watering', async () => {
    const w = await mountWater({ readingsFails: true, status: 'upcoming', daysUntilDue: 9 });
    await doneButtons(taskRowFor(w, 'WATER'))[0]!.trigger('click');
    await flushPromises();

    expect(sendFeedbackMock).not.toHaveBeenCalled();
    expect(w.findAll('.reason-picker').some((p) => p.attributes('data-open') === 'true')).toBe(true);
  });

  // ═════════════════════════════════════════════════════════════════════════════════════════════════
  // QA round 3, HIGH (2026-08-11) — THE PROMOTION HAS AN EXIT, AND THIS PAGE IS WHERE IT WAS MISSING.
  //
  // Press Hecho on the measured card and it came back byte-identical — "Riega ahora", both buttons —
  // surviving a full reload, because a verdict is a stored fact and nothing retracts it. The Today list
  // was closed on the API side (the row simply stops being surfaced); this page renders the plant's own
  // tasks and applies the promotion itself, and it offers Posponer on a WATER row too, so BOTH ways of
  // answering the card survived here.
  //
  // What only this file can pin is the HANDLER half: `careEffectiveStatus` is what `onDone` uses, so a
  // retired promotion means an extra watering on a not-yet-due task is once again an EARLY watering and
  // asks why. Applying the exit to the badge alone would leave the two disagreeing.
  // ═════════════════════════════════════════════════════════════════════════════════════════════════
  //
  // ⚠️ REWRITTEN 2026-08-11 (QA round 5, F1) — IT NOW PINS TWO LAYERS, because the outer one moved. A card
  // "answered with Hecho" is by definition a pot watered today, and F1 withholds a second Hecho on such a
  // row entirely: the discarded post is no longer reachable through this surface at all. That is asserted
  // FIRST. The handler's own retirement is then exercised by emitting `done` DIRECTLY on the row — not by
  // clicking a button the real component no longer renders. That is deliberate, and it is not testing
  // fiction: `onDone` is a separate layer from the row's rendering, this page has a second caller into it
  // (the reading modal's WATER_NOW branch), and the round-3 defect this case was written for lived in the
  // handler, not in the button. Deleting the emit-based half would silently retire the only proof that
  // `careEffectiveStatus` still consults `promptAnsweredToday`/`wateredToday`.
  it('withholds a SECOND Hecho once the card was answered — and the handler still retires the promotion',
    async () => {
      const w = await mountWater({
        todaysVerdict: 'WATER_NOW', status: 'upcoming', daysUntilDue: 9,
        wateredToday: true, promptAnswered: true,
      });
      // F1: there is nothing to press. The row is the pot's own, and the pot is watered.
      expect(doneButtons(taskRowFor(w, 'WATER')).length).toBe(0);

      w.findComponent(TaskRow).vm.$emit('done', { task: 'WATER' });
      await flushPromises();

      // Retired: the row is `upcoming` again, so the handler treats an extra watering as an EARLY one and
      // asks why, instead of sending it through as the app's own prescription.
      expect(sendFeedbackMock).not.toHaveBeenCalled();
      expect(w.findAll('.reason-picker').some((p) => p.attributes('data-open') === 'true')).toBe(true);
    });

  // ⚠️ THE ANTI-ALIASING PIN, DIRECTION B: `promptAnsweredToday` must not be read off `wateredToday`.
  // This is F1's Posponer variant — the owner measured, was told "riega ahora", and said "not today". The
  // day's question IS answered and the promotion must retire, while NOTHING was watered. Wiring
  // `promptAnsweredToday: care.watering?.wateredToday` sends the Done straight through here instead, RED.
  it('the promotion retires on a POSPONER too — answered without watering anything', async () => {
    const w = await mountWater({
      todaysVerdict: 'WATER_NOW', status: 'upcoming', daysUntilDue: 9,
      wateredToday: false, promptAnswered: true,
    });
    await doneButtons(taskRowFor(w, 'WATER'))[0]!.trigger('click');
    await flushPromises();

    expect(sendFeedbackMock).not.toHaveBeenCalled();
    expect(w.findAll('.reason-picker').some((p) => p.attributes('data-open') === 'true')).toBe(true);
  });

  // ⚠️ THE BADGE AND THE HANDLER MUST READ THE SAME FACT. `TaskRow` picks the badge and un-withholds
  // Posponer; this page picks the status it hands `onDone`. Deriving those from different readings is how
  // the app ends up telling the owner to water now and then asking him why he is watering early — so the
  // row is handed the very same `watering.promptAnsweredToday` the two cases above exercise. Dropping the
  // `:prompt-answered-today` binding from the template turns this RED while every handler case stays green,
  // which is exactly the half-application this asserts against.
  it('hands the row the same "already answered" fact it hands its own Done handler', async () => {
    const answered = await mountWater({
      todaysVerdict: 'WATER_NOW', status: 'upcoming', daysUntilDue: 9, promptAnswered: true,
    });
    expect(answered.findComponent(TaskRow).props('promptAnsweredToday')).toBe(true);

    const unanswered = await mountWater({
      todaysVerdict: 'WATER_NOW', status: 'upcoming', daysUntilDue: 9, promptAnswered: false,
    });
    expect(unanswered.findComponent(TaskRow).props('promptAnsweredToday')).toBe(false);
  });

  // ═════════════════════════════════════════════════════════════════════════════════════════════════
  // QA round 4, DEF-2, HIGH (2026-08-11) — THE SECOND EXIT, AND THIS PAGE IS AGAIN WHERE IT SHOWS.
  //
  // Water the pot (the card leaves Today), then measure it and get "Riega ahora". The MODAL gets this right
  // — it withholds Hecho and says there is nothing left to mark as done — and this page promoted the row
  // and offered Hecho anyway, which posts a 200 the API's one-watering-per-day dedup discards, silently and
  // permanently.
  //
  // ⚠️ `promptAnswered: false` IN BOTH CASES, DELIBERATELY. The watering PRECEDES the reading, so the API's
  // `since` bound correctly refuses to count it as an ANSWER — which is what makes this a THIRD term and
  // not a widening of the second, and what makes these cases invisible to any fixture where the pot was not
  // watered today. Dropping `wateredToday` from `careEffectiveStatus` turns them RED.
  // ═════════════════════════════════════════════════════════════════════════════════════════════════
  // ⚠️ REWRITTEN 2026-08-11 (QA round 5, F1), exactly like its sibling above and for the same reason: the
  // page no longer RENDERS a Hecho on a pot watered today, so the handler is reached by emitting `done` on
  // the row rather than by clicking. Both layers are asserted — the button that is not offered, and the
  // handler that would still be right if some future caller emitted it anyway.
  it('DEF-2: withholds Hecho on a pot watered BEFORE the measurement, and the handler still retires', async () => {
    const w = await mountWater({
      todaysVerdict: 'WATER_NOW', status: 'upcoming', daysUntilDue: 9,
      wateredToday: true, promptAnswered: false,
    });
    expect(doneButtons(taskRowFor(w, 'WATER')).length).toBe(0);

    w.findComponent(TaskRow).vm.$emit('done', { task: 'WATER' });
    await flushPromises();
    // Retired: the row is `upcoming` again, so an extra watering is an EARLY watering and asks why,
    // instead of being sent straight through as the app's own prescription.
    expect(sendFeedbackMock).not.toHaveBeenCalled();
    expect(w.findAll('.reason-picker').some((p) => p.attributes('data-open') === 'true')).toBe(true);
  });

  // The badge half, same discipline as its `promptAnsweredToday` sibling above: the row must be handed the
  // same fact the handler reads, or the two disagree on screen. Dropping the `:watered-today` binding turns
  // this RED while the handler case above stays green.
  it('DEF-2: hands the row the same "already watered" fact it hands its own Done handler', async () => {
    const watered = await mountWater({
      todaysVerdict: 'WATER_NOW', status: 'upcoming', daysUntilDue: 9, wateredToday: true,
    });
    expect(watered.findComponent(TaskRow).props('wateredToday')).toBe(true);

    const dry = await mountWater({
      todaysVerdict: 'WATER_NOW', status: 'upcoming', daysUntilDue: 9, wateredToday: false,
    });
    expect(dry.findComponent(TaskRow).props('wateredToday')).toBe(false);
  });

  it('W2: the un-measured row still asks — but through the standalone Done path, since the survey is on ' +
    'offer there', async () => {
    // With the catalogue held and nothing measured, the survey withholds Postpone on this page too; the
    // reachable un-measured postpone is the one a FAILED catalogue hands back (the W1 fallback), which is
    // exactly the "un-gated row" the spec says keeps the picker.
    const w = await mountWater({ readingsFails: true });
    await postponeButtons(taskRowFor(w, 'WATER'))[0]!.trigger('click');
    await flushPromises();

    expect(sendFeedbackMock).not.toHaveBeenCalled();
    expect(w.findAll('.reason-picker').some((p) => p.attributes('data-open') === 'true')).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════
// TASK 8 — CALIBRATION IS REACHED FROM THE PLANT PAGE.
//
// Calibrating a pot's scale used to happen INSIDE the measuring survey, which was circular: one of the two
// anchors is "the pot freshly watered", and supplying it means watering the plant — the decision the survey
// has not made yet. So the anchors moved out (commit 338762e) and the survey now refuses to offer an
// uncalibrated scale, rendering instead a sentence whose link points at `/plants/:id` and promises the
// owner can calibrate it THERE (`SoilReadingModal.test.ts`, "offers a real link to THIS plant's page, where
// calibration lives"). Until this affordance existed, that promise was false: the destination page had no
// calibration control at all, so the owner could neither measure nor calibrate.
//
// ⚠️ THE TWO ENDS OF THAT LINK LIVE IN DIFFERENT FILES AND NOTHING CONNECTED THEM. The sending end is
// pinned in `SoilReadingModal.test.ts`; this block pins the RECEIVING end deliberately using the SAME
// catalogue that end is pinned with — the owner's only enabled instrument is a kitchen scale this pot has
// no anchors for — so the case the link is actually shown for is the case this page is proven to serve.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════
describe('PlantDetail — Task 8: calibration is reached from the plant page', () => {
  // Copied in shape (not imported — it is a fixture, not behaviour) from `SoilReadingModal.test.ts`'s own
  // `kitchenScaleNoCalibration`, which is the fixture that makes THAT file render the link under test here.
  const kitchenScaleNoCalibration = {
    id: 'kitchen-scale', kind: 'moisture', unit: 'grams', scale: 'kitchen-scale-grams',
    direction: 'higher-is-wetter', comparableAcrossPots: false, requiresCalibration: true,
    protocolKind: 'whole-pot-mass', captureKind: 'numeric',
    rawMin: 0, rawMax: null, rawStep: 1, calibration: null,
  };
  // The other half of the gate: an instrument that never needs anchors. `PlantCalibrationModal` filters its
  // whole picker down to `requiresCalibration` rows, so for this owner it could only render its "nothing to
  // set up here" terminal state — a dead end the entry point must not offer a way into.
  const galvanicProbe = {
    id: 'galvanic-probe', kind: 'moisture', unit: 'index', scale: 'probe-1-10',
    direction: 'higher-is-wetter', comparableAcrossPots: false, requiresCalibration: false,
    protocolKind: 'insertion', captureKind: 'numeric',
    rawMin: 1, rawMax: 10, rawStep: 1, calibration: null,
  };

  // Named so `findComponent({ name: 'UiPlantCalibrationModal' })` can locate it and its `saved` event can be
  // fired — the same technique the `UiSoilReadingModal` stubs above use. The real component has its own
  // test file; this block's only concern is that PlantDetail mounts it, opens it, and listens to it.
  const UiPlantCalibrationModalStub = {
    name: 'UiPlantCalibrationModal',
    props: ['open', 'plantId', 'data'],
    emits: ['update:open', 'saved'],
    template: '<div class="calibration-modal" :data-open="String(!!open)" />',
  };
  const localStubs = { ...stubs, UiPlantCalibrationModal: UiPlantCalibrationModalStub };

  // Key-distinguished refreshes, so "it went through `onReadingSaved`" is an assertion about the three
  // reads that seam refreshes, not about a spy the component could satisfy any other way. Same technique as
  // the "a saved measurement also refreshes History" block above.
  const careRefresh = vi.fn(async () => {});
  const readingsRefresh = vi.fn(async () => {});
  const historyRefresh = vi.fn(async () => {});

  beforeEach(() => {
    careRefresh.mockClear();
    readingsRefresh.mockClear();
    historyRefresh.mockClear();
    vi.stubGlobal('useAsyncData', async (key: string, fn: () => Promise<unknown>) => ({
      data: ref(await fn()),
      refresh:
        key.startsWith('care-') ? careRefresh
        : key.startsWith('soil-readings-') ? readingsRefresh
        : vi.fn(async () => {}),
    }));
    vi.stubGlobal('useLazyAsyncData', (key: string, fn: () => Promise<unknown>) => {
      const data = ref<unknown>(null);
      void Promise.resolve(fn()).then((v) => { data.value = v; });
      return { data, refresh: key.startsWith('history-') ? historyRefresh : vi.fn(async () => {}) };
    });
  });

  afterEach(() => {
    // Restore the module's default (non-instrumented) stubs for every other describe block in this file.
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

  async function mountWithInstruments(instruments: Record<string, unknown>[]) {
    vi.stubGlobal('useApi', () => ({
      getPlant: async () => basePlant(),
      getPlantCare: async () => null,
      listPlaces: async () => [],
      getPlantHistory: async () => [],
      getPlantPhotos: async () => [],
      getRepotSigns: async () => ({ signs: [] }),
      getSoilReadings: async () => ({ instruments, protocol: null, readings: [], wateringDays: [] }),
      getOwnerInstruments: async () => ({ available: [], selected: instruments.map((i) => i.id) }),
      invalidatePlant: vi.fn(),
    }));
    const PlantDetail = (await import('./PlantDetail.vue')).default;
    const w = mount(
      { components: { PlantDetail }, template: '<Suspense><PlantDetail id="p1" /></Suspense>' },
      { global: { stubs: localStubs, mocks: { $t: i18n.t, $d: (v: unknown) => String(v) } } },
    );
    await flushPromises();
    return w;
  }

  const calibrateButton = (w: ReturnType<typeof mount>) =>
    w.findAll('button').find((b) => b.text() === i18n.t('reading.calibration.openAction'));

  // Mutation proof: deleting the `@click="calibrationOpen = true"` binding (or the button itself) makes this
  // go RED — `data-open` stays 'false', which is precisely the lockout this task closes.
  it('the entry point the survey\'s link promises IS on this page, and it opens the calibration modal',
    async () => {
      const w = await mountWithInstruments([kitchenScaleNoCalibration]);

      const btn = calibrateButton(w);
      expect(btn, 'the link says "calibrate it there" — there is here').toBeTruthy();
      expect(w.findComponent({ name: 'UiPlantCalibrationModal' }).attributes('data-open')).toBe('false');

      await btn!.trigger('click');
      await flushPromises();

      expect(w.findComponent({ name: 'UiPlantCalibrationModal' }).attributes('data-open')).toBe('true');
    });

  // ONE SEAM, REUSED. A saved calibration changes what the page shows for this pot exactly the way a saved
  // reading does, so it must ride `onReadingSaved` rather than growing a second refresh path that can drift
  // from it (this page has already paid for that once — `onReadingSaved` used to omit the History refresh).
  //
  // Mutation proof: rebinding `@saved` on the calibration modal to a no-op — or to a partial refresh such
  // as `refreshReadings()` alone — makes this go RED on the care/history halves.
  it('a saved calibration refreshes through the SAME onReadingSaved seam a saved reading uses', async () => {
    const w = await mountWithInstruments([kitchenScaleNoCalibration]);

    expect(careRefresh).not.toHaveBeenCalled();
    expect(readingsRefresh).not.toHaveBeenCalled();
    expect(historyRefresh).not.toHaveBeenCalled();

    await w.findComponent({ name: 'UiPlantCalibrationModal' }).vm.$emit('saved');
    await flushPromises();

    expect(careRefresh).toHaveBeenCalled();
    expect(readingsRefresh).toHaveBeenCalled();
    expect(historyRefresh).toHaveBeenCalled();
  });

  // ═══════════════════════════════════════════════════════════════════════════════════════════════════
  // THE SEAM ITSELF, IN ONE PROCESS — the only test in the repo that holds BOTH ends of the link at once.
  //
  // The two sides are two components in two files with two test suites, and each one was green on its own
  // while the journey between them was broken: the survey correctly said "calibrate it there", the
  // destination correctly rendered a plant page, and nobody asked whether "there" contained anything. A
  // promise made by one component about another component's page cannot be checked by either component's
  // own tests — so it is checked here, with ONE catalogue object flowing through both.
  // ═══════════════════════════════════════════════════════════════════════════════════════════════════
  it('THE SEAM: the catalogue that makes the survey promise "calibrate it there" makes THIS page offer it',
    async () => {
      // Mounted FIRST: it installs the `useApi` stub that the modal's own `useApi()` call then resolves.
      const w = await mountWithInstruments([kitchenScaleNoCalibration]);

      // --- THE SENDING END: the real SoilReadingModal, survey mode, on the same catalogue.
      const SoilReadingModal = (await import('./ui/SoilReadingModal.vue')).default;
      const survey = mount(SoilReadingModal, {
        props: {
          open: true,
          plantId: 'p1',
          data: { instruments: [kitchenScaleNoCalibration], protocol: null, readings: [], wateringDays: [] } as never,
          mode: 'survey',
          // Irrelevant to this seam (it is about the calibration link), stated because the prop is
          // required — a caller that forgets the watering fact must not compile.
          wateredToday: false,
        },
        global: {
          mocks: { $t: i18n.t },
          stubs: {
            Modal: { props: ['modelValue', 'title'], template: '<div v-if="modelValue"><slot /><slot name="footer" /></div>' },
            Button: { props: ['disabled', 'loading'], template: '<button :disabled="disabled"><slot /></button>' },
            AppIcon: true,
            'i18n-t': {
              props: ['keypath', 'tag'],
              template: '<span class="i18n-t">{{ $t(keypath) }}<slot name="settings" /><slot name="calibrate" /></span>',
            },
            NuxtLink: { name: 'NuxtLink', props: ['to'], template: '<a class="nuxt-link"><slot /></a>' },
          },
        },
      });
      const link = survey.find('a.nuxt-link');
      expect(link.exists(), 'the survey must be routing the owner somewhere').toBe(true);
      // It is the CALIBRATE link, not the "add one in Settings" one — the two states must not be confused.
      expect(survey.text()).toContain(i18n.t('reading.calibration.calibrateAction'));
      expect(survey.text()).not.toContain(i18n.t('reading.settingsLink'));

      // --- THE RECEIVING END: the page that link actually names.
      // QA finding F3 (2026-08-10) — the link is a route OBJECT now, carrying `?calibrate=1`, because
      // landing at `scrollY: 0` on a 4127px page left the owner hunting for a button 1104px (desktop) /
      // 2694px (mobile) down. Asserted on the object rather than a rendered href so the PATH and the FLAG
      // are pinned separately: a regression that drops the flag but keeps the path — the exact shape of
      // the original defect — fails on its own line, and says so.
      const to = survey.findComponent({ name: 'NuxtLink' }).props('to') as { path: string; query: Record<string, string> };
      expect(to.path).toBe('/plants/p1');
      expect(to.query).toEqual({ calibrate: '1' });
      expect(
        calibrateButton(w),
        'the survey sends the owner to /plants/p1 promising calibration — it has to be there',
      ).toBeTruthy();
    });

  // ---- QA finding F3, the ARRIVAL half ------------------------------------------------------------------
  //
  // The sending end above proves the link carries the flag. These prove the page ACTS on it — which is the
  // half that makes the link actually arrive, rather than merely point.
  it('F3: arriving with ?calibrate=1 opens the calibration modal instead of leaving the owner to hunt',
    async () => {
      routeQuery = { calibrate: '1' };
      const w = await mountWithInstruments([kitchenScaleNoCalibration]);
      // The open is deliberately deferred one tick past the arrival, so the modal is MOUNTED when its flag
      // flips and the shared overlay behaviour actually moves focus into it — see PlantDetail's own comment.
      // Flushing here is therefore part of what this test asserts, not boilerplate around it.
      await flushPromises();
      expect(w.findComponent({ name: 'UiPlantCalibrationModal' }).props('open')).toBe(true);
    });

  // Without the strip, closing the modal leaves `?calibrate=1` in the address bar: a reload or a shared
  // link reopens it forever, and Back steps through a query change instead of leaving the page. `replace`,
  // never `push`, for that second reason.
  it('F3: strips the flag once consumed, leaving no history entry', async () => {
    routeQuery = { calibrate: '1' };
    await mountWithInstruments([kitchenScaleNoCalibration]);
    await flushPromises();
    expect(routerReplaceMock).toHaveBeenCalledTimes(1);
    expect(routerReplaceMock.mock.calls[0][0]).toEqual({ path: '/plants/p1', query: {} });
  });

  // THE NEGATIVE HALF, and it is not symmetry for its own sake: without it, a handler that opened the modal
  // unconditionally would pass both tests above. An ordinary visit must be an ordinary visit.
  it('F3: an ordinary visit opens nothing and rewrites no URL', async () => {
    const w = await mountWithInstruments([kitchenScaleNoCalibration]);
    await flushPromises();
    expect(w.findComponent({ name: 'UiPlantCalibrationModal' }).props('open')).toBe(false);
    expect(routerReplaceMock).not.toHaveBeenCalled();
  });

  // ⚠️ THE VALUE, NOT ITS PRESENCE (QA, 2026-08-11). A presence check opened the dialog for `?calibrate=0`
  // and `?calibrate=abc` alike, which makes the flag's contract meaningless — and `0` reads as "off" to
  // anyone. Both directions are pinned: `'1'` opens, anything else is left entirely alone.
  it.each(['0', 'abc', ''])('F3: ignores ?calibrate=%s — only an explicit 1 opens the modal', async (value) => {
    routeQuery = { calibrate: value };
    const w = await mountWithInstruments([kitchenScaleNoCalibration]);
    await flushPromises();
    expect(w.findComponent({ name: 'UiPlantCalibrationModal' }).props('open')).toBe(false);
    // …and the query is left untouched, rather than being stripped as though it had been consumed.
    expect(routerReplaceMock).not.toHaveBeenCalled();
  });

  // A URL must not be able to conjure a dead end the page itself would never offer: with no calibratable
  // instrument the modal can only render its "nothing to set up here" terminal state, which is exactly why
  // the button is withheld in that case too.
  it('F3: ignores the flag when this owner has no calibratable instrument', async () => {
    routeQuery = { calibrate: '1' };
    const w = await mountWithInstruments([galvanicProbe]);
    await flushPromises();
    expect(w.findComponent({ name: 'UiPlantCalibrationModal' }).props('open')).toBe(false);
    expect(routerReplaceMock).not.toHaveBeenCalled();
  });

  // Mutation proof: dropping the `v-if="canCalibrate"` guard (or weakening it to "the owner has any
  // instrument") makes this go RED. Without it the button is a door onto the modal's "none of your
  // instruments needs calibration" state — true, and with nothing behind it.
  it('offers no calibration button when no enabled instrument requires calibration', async () => {
    const w = await mountWithInstruments([galvanicProbe]);

    expect(calibrateButton(w)).toBeUndefined();
    // …and the absence is the GUARD's doing, not the measurement block failing to render: its sibling
    // affordance is right there. Without this half, deleting the whole block would pass the test above.
    expect(w.findAll('button').some((b) => b.text() === i18n.t('reading.addReading'))).toBe(true);
  });
});
