import { describe, expect, it, beforeEach } from 'vitest';
import {
  singleFlightRefresh, tombstoneJti, isTombstoned, invalidateMemo,
  __resetMemoForTest, MEMO_TTL_MS,
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
});
