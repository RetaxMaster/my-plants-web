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
import { ref, computed, watch } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import en from '../i18n/locales/en.json';
import es from '../i18n/locales/es.json';

const i18n = createI18n({ legacy: false, locale: 'en', fallbackLocale: 'en', messages: { en, es } }).global;

vi.stubGlobal('ref', ref);
vi.stubGlobal('computed', computed);
vi.stubGlobal('watch', watch);
vi.stubGlobal('useI18n', () => ({ t: i18n.t, d: (v: unknown) => String(v), locale: ref('en') }));
vi.stubGlobal('useHead', () => {});
vi.stubGlobal('useSeoMeta', () => {});
vi.stubGlobal('useIsDesktop', () => ref(true));
vi.stubGlobal('useTaskMeta', () => ({ dueLabelLong: () => '', healthLabel: () => '' }));
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
vi.stubGlobal('useRoute', () => ({ path: '/plants/p1' }));

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
  UiButton: UiButtonStub,
  UiModal: UiModalStub,
  UiConfirmModal: UiConfirmModalStub,
  UiFormGroup: UiFormGroupStub,
  UiSelectField: UiSelectFieldStub,
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
  memorializePlantMock.mockClear();
  giftPlantMock.mockClear();
  revivePlantMock.mockClear();
  navigateToMock.mockClear();
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
      emits: ['confirm', 'start-over'],
      template:
        '<div class="done-form" :data-open="open" :data-frozen="frozen" :data-submitting="submitting">' +
        '<button class="confirm-btn" @click="$emit(\'confirm\', { potSizeCm: currentPotSizeCm, soilMix: currentSoilMix, charged: true })">confirm</button>' +
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
    await w.find('.evaluate-btn').trigger('click');
    await flushPromises();
    await w.find('.submit-btn').trigger('click');
    await flushPromises();
    submitDeferreds[0]!.resolve({ evaluationId: 'ev-1', verdict: 'REPOT' });
    await flushPromises();
    // The first attempt's own modal already closed and its own attempt was already cleared — its
    // refresh() is what's still pending.
    expect(w.find('.eval-modal').attributes('data-open')).toBe('false');

    // While the first attempt's refresh() is still pending, the owner reopens and submits AGAIN.
    await w.find('.evaluate-btn').trigger('click');
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
    await w.find('.done-btn').trigger('click');
    await flushPromises();
    await w.find('.confirm-btn').trigger('click');
    await flushPromises();
    completeRepotDeferreds[0]!.resolve({ ok: true });
    await flushPromises();
    expect(w.find('.done-form').attributes('data-open')).toBe('false');

    // While the first attempt's refresh() is still pending, the owner reopens and confirms AGAIN.
    await w.find('.done-btn').trigger('click');
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
    UiTaskRow: {
      props: ['task'],
      emits: ['evaluate', 'done'],
      template:
        '<div>' +
        '<button class="evaluate-btn" @click="$emit(\'evaluate\')">evaluate</button>' +
        '<button class="done-btn" @click="$emit(\'done\', { task: \'REPOT\' })">done</button>' +
        '</div>',
    },
    UiRepotDoneForm: {
      props: ['open', 'currentPotSizeCm', 'currentSoilMix', 'submitting', 'error', 'frozen'],
      emits: ['confirm', 'start-over', 'update:open'],
      template:
        '<div class="done-form" :data-open="open" :data-frozen="frozen" :data-submitting="submitting">' +
        '<button class="confirm-btn" @click="$emit(\'confirm\', { potSizeCm: currentPotSizeCm, soilMix: currentSoilMix, charged: true })">confirm</button>' +
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

    await w.find('.done-btn').trigger('click');
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
    await w.find('.done-btn').trigger('click');
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

    await w.find('.done-btn').trigger('click');
    await flushPromises();
    await w.find('.confirm-btn').trigger('click');
    await flushPromises();
    completeRepotDeferreds[0]!.resolve({ ok: true });
    await flushPromises();
    const keyFirst = completeRepotMock.mock.calls[0]![3];
    expect(w.find('.done-form').attributes('data-open')).toBe('false');

    await w.find('.done-btn').trigger('click');
    await flushPromises();
    expect(w.find('.done-form').attributes('data-frozen')).toBe('false'); // fresh attempt, not resumed

    await w.find('.confirm-btn').trigger('click');
    await flushPromises();
    const keySecond = completeRepotMock.mock.calls[1]![3];
    expect(keySecond).not.toBe(keyFirst); // two genuinely separate confirmations must never share a key
  });
});

// U2: PlantDetail.vue recomputes `occurredOn` via `today()` on EVERY confirm click — including a retry —
// unlike pages/index.vue's module-level constant (that asymmetry is exactly what U2's ruling names). The
// recompute is safe ONLY because `beginDoneAttempt` freezes the WHOLE envelope on the attempt the moment
// the key is minted and resends the STORED envelope (never a freshly recomputed one) on every retry. This
// test proves that by moving the SYSTEM CLOCK itself across a simulated midnight rollover between the
// failed confirm and the retry — i.e. by controlling what `todayYmd()` (which `today()` calls) actually
// reads, never by editing the handler.
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
    UiTaskRow: {
      props: ['task'],
      emits: ['evaluate', 'done'],
      template:
        '<div>' +
        '<button class="evaluate-btn" @click="$emit(\'evaluate\')">evaluate</button>' +
        '<button class="done-btn" @click="$emit(\'done\', { task: \'REPOT\' })">done</button>' +
        '</div>',
    },
    UiRepotDoneForm: {
      props: ['open', 'currentPotSizeCm', 'currentSoilMix', 'submitting', 'error', 'frozen'],
      emits: ['confirm', 'start-over', 'update:open'],
      template:
        '<div class="done-form" :data-open="open" :data-frozen="frozen" :data-submitting="submitting">' +
        '<button class="confirm-btn" @click="$emit(\'confirm\', { potSizeCm: currentPotSizeCm, soilMix: currentSoilMix, charged: true })">confirm</button>' +
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

    await w.find('.done-btn').trigger('click');
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
    UiTaskRow: {
      props: ['task'],
      emits: ['evaluate', 'done'],
      template:
        '<div>' +
        '<button class="evaluate-btn" @click="$emit(\'evaluate\')">evaluate</button>' +
        '<button class="done-btn" @click="$emit(\'done\', { task: \'REPOT\' })">done</button>' +
        '</div>',
    },
    UiRepotDoneForm: {
      props: ['open', 'currentPotSizeCm', 'currentSoilMix', 'submitting', 'error', 'frozen'],
      emits: ['confirm', 'start-over', 'update:open'],
      template:
        '<div class="done-form" :data-open="open" :data-frozen="frozen" :data-submitting="submitting">' +
        '<button class="confirm-btn" @click="$emit(\'confirm\', { potSizeCm: currentPotSizeCm, soilMix: currentSoilMix, charged: true })">confirm</button>' +
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

    await w.find('.done-btn').trigger('click');
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
