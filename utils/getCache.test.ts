import { describe, expect, it } from 'vitest';
import { createGetCache, getCacheKey, getCacheKeyPath } from './getCache.js';

describe('getCacheKey / getCacheKeyPath', () => {
  it('round-trips a plain path', () => {
    const key = getCacheKey('en', '/plants');
    expect(key).toBe('en /plants');
    expect(getCacheKeyPath(key)).toBe('/plants');
  });

  it('round-trips a path containing a query string', () => {
    const key = getCacheKey('es', '/plants?lifecycle=active');
    expect(getCacheKeyPath(key)).toBe('/plants?lifecycle=active');
  });

  it('round-trips a path containing multiple segments', () => {
    const key = getCacheKey('es', '/plants/p1/photos');
    expect(getCacheKeyPath(key)).toBe('/plants/p1/photos');
  });

  it('splits on the FIRST separator only, so a locale like es-MX does not corrupt the split', () => {
    const key = getCacheKey('es-MX', '/plants/p1');
    expect(getCacheKeyPath(key)).toBe('/plants/p1');
  });

  it('returns the input unchanged when there is no separator (defensive fallback)', () => {
    expect(getCacheKeyPath('/plants/p1')).toBe('/plants/p1');
  });
});

describe('createGetCache', () => {
  it('dedupes two concurrent identical GETs into one fetch', async () => {
    const cache = createGetCache();
    let calls = 0;
    const fetcher = () => { calls++; return new Promise((r) => setTimeout(() => r('v'), 5)); };
    const [a, b] = await Promise.all([cache.get('/x', fetcher), cache.get('/x', fetcher)]);
    expect(calls).toBe(1);
    expect(a).toBe('v'); expect(b).toBe('v');
  });

  it('serves a resolved value without re-fetching', async () => {
    const cache = createGetCache();
    let calls = 0;
    const fetcher = async () => { calls++; return 'v'; };
    await cache.get('/x', fetcher);
    await cache.get('/x', fetcher);
    expect(calls).toBe(1);
  });

  it('evicts a REJECTED GET so the next call re-issues it', async () => {
    const cache = createGetCache();
    let calls = 0;
    const fetcher = async () => { calls++; if (calls === 1) throw new Error('boom'); return 'ok'; };
    await expect(cache.get('/x', fetcher)).rejects.toThrow('boom');
    await expect(cache.get('/x', fetcher)).resolves.toBe('ok');
    expect(calls).toBe(2);
  });

  it('flush() forces the next read to re-fetch', async () => {
    const cache = createGetCache();
    let calls = 0;
    const fetcher = async () => { calls++; return `v${calls}`; };
    expect(await cache.get('/x', fetcher)).toBe('v1');
    cache.flush();
    expect(await cache.get('/x', fetcher)).toBe('v2');
  });

  it('invalidate(match) drops ONLY matching keys and forces those to re-fetch, leaving others cached', async () => {
    const cache = createGetCache();
    const calls: Record<string, number> = {};
    const fetcher = (key: string) => async () => { calls[key] = (calls[key] ?? 0) + 1; return `${key}#${calls[key]}`; };

    expect(await cache.get('/plants/p1', fetcher('/plants/p1'))).toBe('/plants/p1#1');
    expect(await cache.get('/plants/p1/photos', fetcher('/plants/p1/photos'))).toBe('/plants/p1/photos#1');
    expect(await cache.get('/plants/p2/photos', fetcher('/plants/p2/photos'))).toBe('/plants/p2/photos#1');

    // Invalidate exactly plant p1's keys (the reconcile's scope). p2 stays cached.
    cache.invalidate((k) => k === '/plants/p1' || k.startsWith('/plants/p1/'));

    expect(await cache.get('/plants/p1', fetcher('/plants/p1'))).toBe('/plants/p1#2'); // re-fetched
    expect(await cache.get('/plants/p1/photos', fetcher('/plants/p1/photos'))).toBe('/plants/p1/photos#2'); // re-fetched
    expect(await cache.get('/plants/p2/photos', fetcher('/plants/p2/photos'))).toBe('/plants/p2/photos#1'); // still cached
  });

  it('invalidate() defuses a matching in-flight entry (it never writes back after being dropped)', async () => {
    const cache = createGetCache();
    let release: (() => void) | undefined;
    const slow = () => new Promise<string>((resolve) => { release = () => resolve('stale'); });
    const inflight = cache.get('/plants/p1/photos', slow);
    cache.invalidate((k) => k.startsWith('/plants/p1'));
    release?.();
    await expect(inflight).resolves.toBe('stale'); // the original caller still resolves...
    expect(await cache.get('/plants/p1/photos', async () => 'fresh')).toBe('fresh'); // ...but nothing was cached
  });

  it('two independent cache instances do not share values (request-scoping at the helper level)', async () => {
    const a = createGetCache(); const b = createGetCache();
    await a.get('/x', async () => 'from-a');
    expect(await b.get('/x', async () => 'from-b')).toBe('from-b');
  });

  it('flush() clears both a resolved value and an in-flight entry (mutation invalidation must hit both states)', async () => {
    const cache = createGetCache();
    let calls = 0;
    const fetcher = async () => { calls++; return `v${calls}`; };

    // First: flush must clear an already-RESOLVED entry.
    expect(await cache.get('/resolved', fetcher)).toBe('v1');
    cache.flush();
    expect(await cache.get('/resolved', fetcher)).toBe('v2');

    // Second: flush must also clear an IN-FLIGHT entry — a concurrent mutation that lands
    // mid-request must not let the stale in-flight promise keep serving future callers.
    let releaseInflight: (() => void) | undefined;
    const slow = () => new Promise<string>((resolve) => {
      releaseInflight = () => resolve('stale');
    });
    const inflightPromise = cache.get('/inflight', slow);
    cache.flush();
    releaseInflight?.();
    await expect(inflightPromise).resolves.toBe('stale'); // the in-flight caller still gets its own result...
    // ...but the cache no longer remembers it: the next call re-fetches instead of replaying 'stale'.
    expect(await cache.get('/inflight', async () => 'fresh')).toBe('fresh');
  });
});
