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
  UiPlantPhoto: { template: '<div><slot name="chips" /><slot name="overlay" /></div>' },
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
  UiImageLightbox: true,
  PlantEditModal: true,
  ProgressEntryModal: true,
  ClinicalRecordModal: true,
  NoteModal: true,
  PlantProfileModal: true,
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
    expect(w.text()).not.toContain('Revive');
  });

  it('shows ONLY revive for a GIFTED plant', async () => {
    const w = await mountDetail(basePlant({
      lifecycleState: 'GIFTED', frozenPlaceLabel: 'Study', frozenCityLabel: 'CDMX',
    }));
    expect(w.text()).toContain('Revive');
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
    expect(w.findAll('button').some((b) => b.text() === 'Revive')).toBe(false);
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
    await findButtonByText(w, 'Revive').trigger('click');
    await flushPromises();

    // Two "Revive" buttons now exist (the trigger, still rendered behind the now-open modal, and the
    // modal's own confirm) — the confirm one lives inside `.generic-modal` and starts disabled (no place
    // chosen yet).
    const modalConfirm = w.get('.generic-modal').findAll('button').find((b) => b.text() === 'Revive')!;
    expect((modalConfirm.element as HTMLButtonElement).disabled).toBe(true);

    await w.get('.revive-select').setValue('pl1');
    await flushPromises();

    const confirmAfter = w.get('.generic-modal').findAll('button').find((b) => b.text() === 'Revive')!;
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
