import { describe, expect, it, beforeEach } from 'vitest';
import {
  singleFlightRefresh, tombstoneJti, isTombstoned, invalidateMemo,
  __resetMemoForTest, __mapSizesForTest, MEMO_TTL_MS, TOMBSTONE_TTL_MS, REFRESH_TIMEOUT_MS,
} from './refreshMemo.js';

describe('refreshMemo', () => {
  beforeEach(() => __resetMemoForTest());

  it('collapses CONCURRENT slides of one jti to a single refresh', async () => {
    let calls = 0;
    const doRefresh = async () => { calls++; return { token: 't1' }; };
    const [a, b, c] = await Promise.all([
      singleFlightRefresh('j', Date.now(), doRefresh),
      singleFlightRefresh('j', Date.now(), doRefresh),
      singleFlightRefresh('j', Date.now(), doRefresh),
    ]);
    expect(calls).toBe(1);
    expect([a.token, b.token, c.token]).toEqual(['t1', 't1', 't1']);
  });

  it('collapses SEQUENTIAL slides of one jti (within TTL) to a single refresh', async () => {
    let calls = 0;
    const doRefresh = async () => { calls++; return { token: 't1' }; };
    const now = 1_000_000;
    await singleFlightRefresh('j', now, doRefresh);
    await singleFlightRefresh('j', now + 5, doRefresh);
    expect(calls).toBe(1);
  });

  it('re-refreshes once the memo entry is past MEMO_TTL_MS (treated as absent on read)', async () => {
    let calls = 0;
    const doRefresh = async () => { calls++; return { token: `t${calls}` }; };
    const now = 1_000_000;
    await singleFlightRefresh('j', now, doRefresh);
    const r2 = await singleFlightRefresh('j', now + MEMO_TTL_MS + 1, doRefresh);
    expect(calls).toBe(2);
    expect(r2.token).toBe('t2');
  });

  it('evicts a REJECTED refresh so the next call re-issues it', async () => {
    let calls = 0;
    const doRefresh = async () => { calls++; if (calls === 1) throw new Error('boom'); return { token: 'ok' }; };
    await expect(singleFlightRefresh('j', Date.now(), doRefresh)).rejects.toThrow('boom');
    const r = await singleFlightRefresh('j', Date.now(), doRefresh);
    expect(r.token).toBe('ok');
    expect(calls).toBe(2);
  });

  it('tombstone is live until its TTL and invalidateMemo drops the entry', async () => {
    const now = 1_000_000;
    tombstoneJti('j', now);
    expect(isTombstoned('j', now + 100)).toBe(true);
    expect(isTombstoned('j', now + 60_001)).toBe(false);

    let kCalls = 0;
    const doK = async () => { kCalls++; return { token: 'x' }; };
    await singleFlightRefresh('k', now, doK);
    await singleFlightRefresh('k', now + 1, doK); // reuse — no new call
    expect(kCalls).toBe(1);
    invalidateMemo('k');
    await singleFlightRefresh('k', now + 2, doK); // entry gone → re-runs
    expect(kCalls).toBe(2);
  });

  it('prunes expired resolved memo + tombstone entries on write, bounding both maps (Finding 7)', async () => {
    const now = 1_000_000;
    const doRefresh = async () => ({ token: 't' });
    // Seed a batch of one-shot jtis + tombstones that are never revisited (the real leak: a superseded
    // jti never returns, so without pruning its expired entry would live for the process lifetime).
    for (let i = 0; i < 25; i++) {
      await singleFlightRefresh(`old-${i}`, now, doRefresh);
      tombstoneJti(`old-${i}`, now);
    }
    expect(__mapSizesForTest().memo).toBe(25);
    expect(__mapSizesForTest().tombstones).toBe(25);

    // A later write happens well past every entry's TTL — the prune-on-write sweeps the stale ones,
    // leaving only the fresh one.
    const later = now + TOMBSTONE_TTL_MS + 1;
    await singleFlightRefresh('fresh', later, doRefresh);
    tombstoneJti('fresh', later);
    expect(__mapSizesForTest().memo).toBe(1);
    expect(__mapSizesForTest().tombstones).toBe(1);
  });

  it('never prunes a memo entry whose refresh is still IN FLIGHT (would re-issue a duplicate)', async () => {
    const now = 1_000_000;
    let resolve!: (v: { token: string }) => void;
    const pending = new Promise<{ token: string }>((r) => { resolve = r; });
    const inflight = singleFlightRefresh('slow', now, () => pending);
    // A much-later write must NOT evict the still-pending 'slow' entry.
    await singleFlightRefresh('other', now + TOMBSTONE_TTL_MS + 1, async () => ({ token: 'o' }));
    expect(__mapSizesForTest().memo).toBe(2);
    resolve({ token: 'slow' });
    expect((await inflight).token).toBe('slow');
  });

  it('bounds the refresh strictly below the tombstone lifetime so a late refresh cannot reopen a session (Finding 3)', () => {
    // The invariant the middleware relies on: a refresh in flight at logout resolves/aborts while the
    // logout tombstone is still active.
    expect(REFRESH_TIMEOUT_MS).toBeLessThan(TOMBSTONE_TTL_MS);
    expect(MEMO_TTL_MS).toBeLessThan(TOMBSTONE_TTL_MS);
  });
});
