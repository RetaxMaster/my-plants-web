// @vitest-environment happy-dom
//
// Import-on-create retry durability (Plant Lifecycle feature, Task 29). The two behaviors that matter most
// here are invisible to typecheck/build: (1) an import with zero photos must still CLOSE its batch (finish
// Import), never leaving it open for the TTL sweep, and (2) a chunk failure followed by a re-submit must
// reuse the already-created plant (never a second createPlant, which would duplicate the plant) and must
// never durably double-upload a photo that already landed — the per-clientKey idempotency on the server is
// the safety net, but the client itself should only resend what is still outstanding.
//
// Mirrors pages/plants/index.test.ts's Suspense-mounting convention: the page's `<script setup>` awaits
// `useAsyncData` at the top level, which makes setup async, and an async setup renders nothing without a
// <Suspense> boundary above it.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ref, reactive, computed, watch } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { todayYmd } from '../../utils/localDate.js';

vi.stubGlobal('ref', ref);
vi.stubGlobal('reactive', reactive);
vi.stubGlobal('computed', computed);
vi.stubGlobal('watch', watch);
vi.stubGlobal('useI18n', () => ({ t: (k: string) => k, locale: ref('en') }));
vi.stubGlobal('useHead', () => {});
vi.stubGlobal('useSeoMeta', () => {});
vi.stubGlobal('navigateTo', vi.fn());
vi.stubGlobal('useAsyncData', async (_key: string, fn: () => Promise<unknown>) => ({ data: ref(await fn()) }));

// The shared SOIL_MIXES vocabulary, real values (task 14 §2.3) — copied here rather than imported so this
// test asserts the page reads it THROUGH `useProfileMeta`, never through a local literal of its own.
const SOIL_MIXES = [
  'aroid', 'all-purpose', 'all-purpose-perlite', 'cactus-succulent', 'orchid-bark',
  'peat-based', 'coco-coir', 'semi-hydro', 'other',
];
vi.stubGlobal('useProfileMeta', () => ({
  soilMixOptions: computed(() => SOIL_MIXES.map((v) => ({ value: v, label: v }))),
  // The REAL implementation, copied deliberately rather than faked to something convenient — see
  // composables/useProfileMeta.ts. Three lines, no dependencies of its own.
  withNotSet: (opts: { value: string; label: string }[], notSetLabel?: string | null) =>
    [{ value: '', label: notSetLabel ?? 'plantProfile.pickOption' }, ...opts],
}));

const routerPush = vi.fn();
vi.stubGlobal('useRouter', () => ({ push: routerPush }));

const createPlantMock = vi.fn();
const appendImportChunkMock = vi.fn();
const finishImportMock = vi.fn();
const setCoverPhotoMock = vi.fn();
const recomputeMock = vi.fn();

vi.stubGlobal('useApi', () => ({
  listSpecies: async () => [{ slug: 'ficus-lyrata', scientificName: 'Ficus lyrata', commonNameEs: null, commonNameEn: null }],
  listPlaces: async () => [{ id: 'pl1', name: 'Study' }],
  createPlant: createPlantMock,
  appendImportChunk: appendImportChunkMock,
  finishImport: finishImportMock,
  setCoverPhoto: setCoverPhotoMock,
  recompute: recomputeMock,
}));

const stubs = {
  UiScreenHeader: true,
  UiFormGroup: { template: '<div><slot /></div>' },
  UiSelectField: { name: 'UiSelectField', props: ['modelValue', 'options', 'placeholder'], template: '<select />' },
  UiInput: true,
  UiSwitch: true,
  UiImageDropzone: true,
  UiButton: true,
};

async function mountPage() {
  const PlantsNew = (await import('./new.vue')).default;
  const w = mount(
    { components: { PlantsNew }, template: '<Suspense><PlantsNew /></Suspense>' },
    { global: { stubs, mocks: { $t: (k: string) => k } } },
  );
  await flushPromises();
  // The wrapper's own `w.vm` is the Suspense host, not the page — every internal ref/method this file
  // reaches into (form, importState, importPhotos, submit()) lives on the page's own instance.
  return w.findComponent(PlantsNew);
}

// A minimal already-compressed result, aligned by index with the fake `File`s the tests push into
// `importPhotos` — mirrors what `UiImageDropzone`'s compress mode would hand back.
function fakeResult(i: number) {
  return { blob: new Blob([`p${i}`]), filename: `p${i}.jpg`, mimeType: 'image/jpeg', originalBytes: 10, sentBytes: 5, wasOptimised: true };
}

beforeEach(() => {
  createPlantMock.mockReset();
  appendImportChunkMock.mockReset();
  finishImportMock.mockReset();
  setCoverPhotoMock.mockReset();
  recomputeMock.mockReset();
  routerPush.mockReset();
  finishImportMock.mockResolvedValue(undefined);
});

describe('import-on-create — retry durability', () => {
  it('a zero-photo import still closes the batch (finishImport is called even with no photos)', async () => {
    createPlantMock.mockResolvedValue({ id: 'p1' });
    const w = await mountPage();

    (w.vm as any).importState = 'MEMORIAL';
    (w.vm as any).form.speciesSlug = 'ficus-lyrata';
    // importPhotos stays empty — nothing was picked for this import.
    await (w.vm as any).submit();
    await flushPromises();

    expect(createPlantMock).toHaveBeenCalledTimes(1);
    // 2nd arg is Task 9's submit-anchored idempotency key — any non-empty string is fine here, its own
    // behavior is asserted separately below in "submit-anchored stable idempotency key (Task 9)".
    expect(createPlantMock).toHaveBeenCalledWith(
      expect.objectContaining({ speciesSlug: 'ficus-lyrata', lifecycleState: 'MEMORIAL' }),
      expect.any(String),
    );
    expect(appendImportChunkMock).not.toHaveBeenCalled(); // nothing to send
    expect(finishImportMock).toHaveBeenCalledTimes(1); // but the batch is still closed
    expect(finishImportMock).toHaveBeenCalledWith('p1');
    expect(routerPush).toHaveBeenCalledWith('/pantheon/p1');
  });

  it('create → chunk failure → re-submit: exactly ONE createPlant call, no duplicate photos durably uploaded', async () => {
    createPlantMock.mockResolvedValue({ id: 'p1' });
    // 9 photos ⇒ chunk 1 = photos [0..7], chunk 2 = photo [8]. The 2nd wire call (chunk 2, first attempt)
    // fails; the 3rd wire call (chunk 2, retried after re-submit) succeeds.
    let call = 0;
    const chunkCalls: string[][] = [];
    appendImportChunkMock.mockImplementation(async (_plantId: string, form: FormData) => {
      call += 1;
      chunkCalls.push(form.getAll('clientKeys') as string[]);
      if (call === 2) throw new Error('network blip');
    });

    const w = await mountPage();
    (w.vm as any).importState = 'GIFTED';
    (w.vm as any).form.speciesSlug = 'ficus-lyrata';
    const files = Array.from({ length: 9 }, (_, i) => new File([`x${i}`], `p${i}.jpg`));
    (w.vm as any).importPhotos = files;
    (w.vm as any).importResults = files.map((_, i) => fakeResult(i));
    await flushPromises(); // let the clientKey-assignment watcher run

    // First submit: chunk 1 succeeds, chunk 2 throws — the page surfaces the error and stops.
    await (w.vm as any).submit();
    await flushPromises();
    expect((w.vm as any).error).toBeTruthy();
    expect(finishImportMock).not.toHaveBeenCalled(); // the batch never got to close on the failed attempt

    // Re-submit: must NOT create a second plant, and must resume with only the outstanding chunk.
    await (w.vm as any).submit();
    await flushPromises();

    expect(createPlantMock).toHaveBeenCalledTimes(1); // never re-created on retry
    expect(chunkCalls).toHaveLength(3); // chunk1(ok) + chunk2(fail) + chunk2(retry, ok)
    // The two SUCCESSFUL wire calls (chunk 1, and the retried chunk 2) are what durably lands photos —
    // their clientKeys must cover every photo exactly once, with zero overlap between them.
    const successfulKeys = [...chunkCalls[0], ...chunkCalls[2]];
    expect(successfulKeys).toHaveLength(9);
    expect(new Set(successfulKeys).size).toBe(9); // no duplicates among durably-uploaded photos
    expect(finishImportMock).toHaveBeenCalledTimes(1);
    expect(finishImportMock).toHaveBeenCalledWith('p1');
    expect(routerPush).toHaveBeenCalledWith('/gifted/p1');
  });
});

describe('submit-anchored stable idempotency key (Task 9)', () => {
  it('the first submit calls createPlant with a non-empty string key as the 2nd arg', async () => {
    createPlantMock.mockResolvedValue({ id: 'p1' });
    const w = await mountPage();

    (w.vm as any).form.speciesSlug = 'ficus-lyrata';
    (w.vm as any).form.placeId = 'pl1';
    await (w.vm as any).submit();
    await flushPromises();

    expect(createPlantMock).toHaveBeenCalledTimes(1);
    const key = createPlantMock.mock.calls[0][1];
    expect(typeof key).toBe('string');
    expect(key.length).toBeGreaterThan(0);
  });

  it('stable across retry: a timed-out create is retried with the SAME idempotency key, never a fresh one', async () => {
    // First attempt "times out" (createPlant rejects, simulating a lost response after the server may have
    // already committed); the retry must reuse the exact same key — that reuse is what lets the server
    // recognize it as the same create and return the existing plant instead of duplicating it.
    createPlantMock.mockRejectedValueOnce(new Error('timeout'));
    createPlantMock.mockResolvedValueOnce({ id: 'p1' });
    const w = await mountPage();

    (w.vm as any).form.speciesSlug = 'ficus-lyrata';
    (w.vm as any).form.placeId = 'pl1';

    await (w.vm as any).submit();
    await flushPromises();
    expect((w.vm as any).error).toBeTruthy();
    expect(createPlantMock).toHaveBeenCalledTimes(1);
    const firstKey = createPlantMock.mock.calls[0][1];
    expect(typeof firstKey).toBe('string');
    expect(firstKey.length).toBeGreaterThan(0);

    await (w.vm as any).submit();
    await flushPromises();

    expect(createPlantMock).toHaveBeenCalledTimes(2);
    const secondKey = createPlantMock.mock.calls[1][1];
    expect(secondKey).toBe(firstKey); // same key reused on retry, never a fresh one
    expect(routerPush).toHaveBeenCalledWith('/plants/p1');
  });

  it('after a successful create, the cover-photo/recompute path is unaffected by the idempotency key', async () => {
    createPlantMock.mockResolvedValue({ id: 'p1' });
    recomputeMock.mockResolvedValue({ ok: true });
    const w = await mountPage();

    (w.vm as any).form.speciesSlug = 'ficus-lyrata';
    (w.vm as any).form.placeId = 'pl1';
    await (w.vm as any).submit();
    await flushPromises();

    expect(setCoverPhotoMock).not.toHaveBeenCalled(); // no photo was picked — unrelated to the key
    expect(recomputeMock).toHaveBeenCalledTimes(1);
    expect(routerPush).toHaveBeenCalledWith('/plants/p1');
  });
});

describe('the soil mix at registration (spec §2.3)', () => {
  // ⚠️ STRICT, not objectContaining. Every existing assertion in this file matches loosely, which is
  // exactly why a field can quietly stop being sent without one test noticing. This case asserts the WHOLE
  // body, so dropping `soilMix` — or sending `''` instead of `null` — turns it red.
  it('sends soilMix: null when the owner leaves it at "I don\'t know"', async () => {
    createPlantMock.mockResolvedValue({ id: 'p1' });
    const w = await mountPage();
    (w.vm as any).form.speciesSlug = 'ficus-lyrata';
    (w.vm as any).form.placeId = 'pl1';
    await (w.vm as any).submit();
    await flushPromises();

    expect(createPlantMock.mock.calls[0]![0]).toEqual({
      speciesSlug: 'ficus-lyrata',
      placeId: 'pl1',
      nickname: undefined,
      acquiredOn: todayYmd(),
      lifecycleState: undefined,
      substrateRefreshedOn: undefined,
      substrateCharged: undefined,
      soilMix: null,
    });
  });

  it('sends the chosen slug when the owner picks one', async () => {
    createPlantMock.mockResolvedValue({ id: 'p1' });
    const w = await mountPage();
    (w.vm as any).form.speciesSlug = 'ficus-lyrata';
    (w.vm as any).form.placeId = 'pl1';
    (w.vm as any).soilMix = 'aroid';
    await (w.vm as any).submit();
    await flushPromises();
    expect(createPlantMock.mock.calls[0]![0]).toMatchObject({ soilMix: 'aroid' });
  });

  it('offers the SHARED vocabulary plus an explicit "I don\'t know", never a local literal', async () => {
    const w = await mountPage();
    const select = w.findAllComponents({ name: 'UiSelectField' })
      .find((c) => (c.props('options') as any[])?.some((o) => o.value === 'aroid'));
    const values = (select!.props('options') as { value: string }[]).map((o) => o.value);
    expect(values[0]).toBe('');                       // "I don't know", ENABLED and re-selectable
    expect(values).toContain('aroid');
    expect(values.length).toBeGreaterThan(2);          // the real SOIL_MIXES list, not a hand-written pair
  });
});
