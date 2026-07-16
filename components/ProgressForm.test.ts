// @vitest-environment happy-dom
//
// ProgressForm is the ONE shared register/edit form (fork-prevention — spec §3.1); these tests exercise
// its behavior directly rather than trusting typecheck+build alone. `useI18n`/`useApi`/`useAsyncData`/
// `useTaskMeta` are bare Nuxt auto-imports the component calls at setup time — outside Nuxt's build
// pipeline (plain vitest + @vue/test-utils, no auto-import shim) they don't exist as globals, so they're
// stubbed the way `HistoryTimeline.test.ts` stubs `useI18n`. `readImageSize` is mocked at the module
// boundary so the courtesy pixel check is deterministic.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { ref, computed } from 'vue';
import ProgressForm from './ProgressForm.vue';

const readImageSizeMock = vi.fn();
vi.mock('../composables/useReadImageSize', () => ({ readImageSize: (f: File) => readImageSizeMock(f) }));

// `ref`/`computed` are Vue's own reactivity primitives, normally auto-imported by Nuxt's build pipeline
// (the rest of the codebase calls them bare, e.g. components/ui/Button.vue). Plain `vitest` + `@vue/test-
// utils` (no Nuxt auto-import shim registered in vitest.config.ts) doesn't provide that global, so a bare
// `ref()` call inside ProgressForm's setup() throws "ref is not defined" — stub the real implementations
// as globals, same technique as the useI18n stub below, rather than change the component's convention.
vi.stubGlobal('ref', ref);
vi.stubGlobal('computed', computed);

vi.stubGlobal('useI18n', () => ({
  t: (key: string, params?: Record<string, unknown>) => (params ? `${key}:${JSON.stringify(params)}` : key),
  locale: { value: 'en' },
}));
vi.stubGlobal('useTaskMeta', () => ({
  healthLabel: (code: string) => `health.${code}`,
}));
vi.stubGlobal('useApi', () => ({
  getProgressCatalog: () => Promise.resolve([
    { key: 'NEW_LEAF', label: 'New leaf', group: 'positive' },
    { key: 'SEEDLING', label: 'Seedling', group: 'positive' },
    { key: 'PESTS', label: 'Pests', group: 'negative' },
  ]),
}));
// A minimal stand-in for Nuxt's useAsyncData: resolves the fetcher and exposes `data` as a ref, without
// the SSR-blocking `await` semantics real Nuxt pages rely on (ProgressForm intentionally does not await
// it — see the component's own comment).
vi.stubGlobal('useAsyncData', (_key: string, fn: () => Promise<unknown>) => {
  const data = ref<unknown>(null);
  fn().then((v) => { data.value = v; });
  return { data };
});

const initialEntry = {
  id: 'e1', plantId: 'p1', occurredOn: '2026-07-01', health: 'GOOD',
  observations: 'looking good', sizeCm: 30,
  tags: [{ key: 'NEW_LEAF', group: 'positive' }, { key: 'PESTS', group: 'negative' }],
  photos: [], processingCount: 0, failedCount: 0,
};

function mountForm(props: Record<string, unknown>) {
  return mount(ProgressForm, {
    // `mode`'s presence is enforced at the ProgressForm.vue prop-type level; this helper's callers always
    // pass it, but the spread of a loose `Record<string, unknown>` defeats vue-tsc's structural check.
    props: { saveLabel: 'Save', ...props } as InstanceType<typeof ProgressForm>['$props'],
    global: {
      // Only stub components whose OWN behavior would otherwise get in the way (a real UiButton/UiSlider
      // has no reactivity to fake here; UiImageDropzone manages its own object-URL previews we don't want
      // spun up in a test). Everything else (UiCard, UiFormGroup, UiSwitch, UiAppIcon, and the raw
      // <button>/<img>/<span> photo-manager markup) is NOT globally registered outside Nuxt's build
      // pipeline, so it falls back to a plain native tag — which, unlike an explicit `true` stub, still
      // renders its slot content. That's what the photo-manager DOM assertions below rely on.
      stubs: { UiTagChip: true, UiButton: true, UiSlider: true, UiImageDropzone: true },
      mocks: { $t: (k: string) => k },
    },
  });
}

beforeEach(() => readImageSizeMock.mockReset());

describe('ProgressForm', () => {
  it('create mode: blank defaults, emits a payload with only chosen fields', async () => {
    const w = mountForm({ mode: 'create' });
    // choose GOOD health, observations, two tags via the component's exposed handlers
    (w.vm as any).health = 'GOOD';
    (w.vm as any).observations = 'first note';
    (w.vm as any).selectedTags = ['NEW_LEAF', 'SEEDLING'];
    (w.vm as any).submit();
    const payload = w.emitted('submit')![0][0] as any;
    expect(payload).toEqual({
      health: 'GOOD', occurredOn: '', observations: 'first note',
      sizeCm: null, tags: ['NEW_LEAF', 'SEEDLING'], files: [], removePhotoIds: [],
    });
  });

  it('edit mode: prefills every field from `initial`', () => {
    const w = mountForm({ mode: 'edit', initial: initialEntry });
    expect((w.vm as any).health).toBe('GOOD');
    expect((w.vm as any).occurredOn).toBe('2026-07-01');
    expect((w.vm as any).observations).toBe('looking good');
    expect((w.vm as any).recordSize).toBe(true);
    expect((w.vm as any).sizeCm).toBe(30);
    expect((w.vm as any).selectedTags).toEqual(['NEW_LEAF', 'PESTS']);
  });

  it('edit mode: emits a create/edit-parity payload including removePhotoIds', async () => {
    const withPhoto = {
      ...initialEntry,
      photos: [{ id: 'ph1', status: 'READY', imageUrl: 'u', sortOrder: 0, originalName: 'a', failureKind: null, failureCode: null, retryable: false }],
    };
    const w = mountForm({ mode: 'edit', initial: withPhoto });
    (w.vm as any).markRemove('ph1');
    (w.vm as any).observations = 'edited';
    (w.vm as any).submit();
    const payload = w.emitted('submit')![0][0] as any;
    expect(payload.removePhotoIds).toEqual(['ph1']);
    expect(payload.observations).toBe('edited');
    expect(payload.health).toBe('GOOD'); // unchanged field preserved
  });

  it('courtesy pixel check refuses a confident over-limit file and passes an unreadable one (fail-open), both modes', async () => {
    for (const mode of ['create', 'edit'] as const) {
      readImageSizeMock.mockReset();
      const big = new File(['x'], 'huge.jpg');
      const unknown = new File(['y'], 'mystery.jpg');
      readImageSizeMock.mockImplementation((f: File) => (f === big ? { width: 9000, height: 9000 } : null));
      const w = mountForm(mode === 'edit' ? { mode, initial: initialEntry } : { mode });
      await (w.vm as any).onFilesPicked([big, unknown]);
      expect((w.vm as any).files).toEqual([unknown]); // over-limit dropped, unreadable passes through
      expect((w.vm as any).pixelError).toContain('huge.jpg'); // rejected with its name
    }
  });
});

const photo = (id: string, status: string, extra: Record<string, unknown> = {}) => ({
  id, status, imageUrl: status === 'READY' ? `${id}.jpg` : null, sortOrder: 0,
  originalName: `${id}.jpg`, failureKind: null, failureCode: null, retryable: false, ...extra,
});

describe('ProgressForm — edit photo manager', () => {
  it('renders the correct control per photo status', () => {
    const photos = [
      photo('r', 'READY'), photo('pe', 'PENDING'), photo('pr', 'PROCESSING'), photo('rc', 'RECOVERING'),
      photo('ft', 'FAILED', { failureKind: 'transient', retryable: true }),
      photo('fp', 'FAILED', { failureKind: 'permanent', retryable: false }),
    ];
    const w = mountForm({ mode: 'edit', initial: { ...initialEntry, photos } });
    const tile = (id: string) => w.get(`[data-photo="${id}"]`);
    expect(tile('r').find('img').exists()).toBe(true);
    expect(tile('r').get('[data-act="remove"]').attributes('disabled')).toBeUndefined(); // READY remove enabled
    expect(tile('pe').get('[data-act="remove"]').attributes('disabled')).toBeUndefined(); // PENDING remove enabled
    expect(tile('pr').get('[data-act="remove"]').attributes('disabled')).toBeDefined(); // PROCESSING remove disabled
    expect(tile('rc').get('[data-act="remove"]').attributes('disabled')).toBeDefined(); // RECOVERING remove disabled
    expect(tile('ft').find('[data-act="retry"]').exists()).toBe(true); // transient → retry offered
    expect(tile('fp').find('[data-act="retry"]').exists()).toBe(false); // permanent → no retry
  });

  it('remove marks the id (tile shows is-removed) and the submit payload carries it', async () => {
    const w = mountForm({ mode: 'edit', initial: { ...initialEntry, photos: [photo('r', 'READY')] } });
    await w.get('[data-photo="r"] [data-act="remove"]').trigger('click');
    expect(w.get('[data-photo="r"]').classes()).toContain('is-removed');
    (w.vm as any).submit();
    expect((w.emitted('submit')![0][0] as any).removePhotoIds).toEqual(['r']);
  });

  it('retry emits "retry" with the photo id immediately (does not wait for submit)', async () => {
    const photos = [photo('ft', 'FAILED', { failureKind: 'transient', retryable: true })];
    const w = mountForm({ mode: 'edit', initial: { ...initialEntry, photos } });
    await w.get('[data-photo="ft"] [data-act="retry"]').trigger('click');
    expect(w.emitted('retry')?.[0]).toEqual(['ft']);
    expect(w.emitted('submit')).toBeUndefined(); // fired immediately, not on submit
  });

  it('remaining-slots cap reflects existing − pending-removals + newly-added', async () => {
    const photos = Array.from({ length: 6 }, (_, i) => photo(`p${i}`, 'READY'));
    const w = mountForm({ mode: 'edit', initial: { ...initialEntry, photos } });
    (w.vm as any).markRemove('p0'); // remove 1 → 5 remain
    (w.vm as any).files = [new File(['a'], 'a.jpg'), new File(['b'], 'b.jpg')]; // add 2
    await w.vm.$nextTick();
    expect((w.vm as any).remainingSlots).toBe(1); // 8 - 5 - 2 = 1
  });
});
