import { describe, expect, it } from 'vitest';
import { createGetCache } from './getCache.js';

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
