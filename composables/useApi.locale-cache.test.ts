// Regression test for the locale-cache-key fix (see utils/getCache.ts's GET_CACHE_KEY_SEP/getCacheKey/
// getCacheKeyPath and useApi.ts's `cache.get(getCacheKey(locale.value, path), ...)` + `invalidatePlant`).
// `utils/getCache.test.ts` covers the two new helpers IN ISOLATION, which does NOT prove useApi.ts actually
// calls them, or that invalidatePlant still matches once its keys carry a locale prefix — both regressions
// would stay green under that file alone. This file exercises the REAL `useApi()` composable end to end, so
// a revert of either wiring point fails here even though the isolated helper tests keep passing.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ref } from 'vue';
import { useApi, flushClientGetCache } from './useApi';

let locale: ReturnType<typeof ref<string>>;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  // The client-side GET cache lives at MODULE scope (one per browser tab) — it survives across test files
  // AND across test cases in this same file unless flushed, so a prior case's cached entries would leak
  // into the next one and make the outcome depend on run order. Start every case from empty.
  flushClientGetCache();

  locale = ref('en');
  // The fetcher reads `locale.value` at CALL time, standing in for what the real BFF proxy does server-side
  // (forward an `x-locale` header derived from the active locale and return a locale-dependent body) — this
  // is the one thing the test needs to fake, since the proxy itself is out of scope here.
  fetchMock = vi.fn(async () => ({ locale: locale.value }));

  vi.stubGlobal('$fetch', fetchMock);
  // useApi() takes the CLIENT branch under this repo's vitest.config.ts (import.meta.server rewritten to
  // `false`), so useRequestFetch()/useRequestEvent() are never actually invoked — stub them to throw just in
  // case a future edit to useApi.ts accidentally reaches the server branch under test.
  vi.stubGlobal('useRequestFetch', () => { throw new Error('useRequestFetch must not be called on the client branch'); });
  vi.stubGlobal('useRequestEvent', () => { throw new Error('useRequestEvent must not be called on the client branch'); });
  vi.stubGlobal('useUserSession', () => ({ loggedIn: ref(false), clear: vi.fn() }));
  vi.stubGlobal('useI18n', () => ({ t: (k: string) => k, locale }));
  vi.stubGlobal('navigateTo', vi.fn());
});

describe('useApi() GET cache is keyed by locale, not by path alone', () => {
  it('dedupes repeats under the SAME locale, then refetches — and returns the NEW body — after a locale switch', async () => {
    const api = useApi();

    const first = await api.listSpecies();
    const second = await api.listSpecies();
    // Same locale, same path: the second call is served from cache, never re-hits the network.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);

    locale.value = 'es';
    const third = await api.listSpecies();
    // A language switch is a genuinely new key: the fetcher runs again...
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // ...and the caller gets the NEW locale's body, not the stale 'en' one a path-only key would have kept
    // serving until a full reload — this is the user-visible property the fix restores.
    expect(third).not.toEqual(first);
    expect((third as unknown as { locale: string }).locale).toBe('es');
  });
});

describe('useApi().invalidatePlant still matches once cache keys carry a locale prefix', () => {
  it('drops the plant-scoped cached GETs while leaving an unrelated cached GET untouched', async () => {
    const api = useApi();

    await api.getPlant('p1');
    await api.getPlantPhotos('p1');
    await api.listSpecies();
    expect(fetchMock).toHaveBeenCalledTimes(3);

    // Re-reading all three right now must be fully served from cache — establishes the baseline before
    // invalidation actually does anything.
    await api.getPlant('p1');
    await api.getPlantPhotos('p1');
    await api.listSpecies();
    expect(fetchMock).toHaveBeenCalledTimes(3);

    api.invalidatePlant('p1');

    await api.getPlant('p1');
    await api.getPlantPhotos('p1');
    // The two plant-scoped reads were evicted and re-fetch...
    expect(fetchMock).toHaveBeenCalledTimes(5);

    await api.listSpecies();
    // ...but the unrelated read is untouched: still served from cache, no extra fetch.
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });
});
