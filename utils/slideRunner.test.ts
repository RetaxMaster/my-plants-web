import { describe, expect, it, beforeEach, vi } from 'vitest';
import { applySlide, type SlideDeps } from './slideRunner.js';
import { __resetMemoForTest, tombstoneJti } from './refreshMemo.js';

function backdatedToken(jti = 'j1'): string {
  const nowSec = Math.floor(Date.now() / 1000);
  const iat = nowSec - 16 * 24 * 60 * 60;
  const exp = iat + 30 * 24 * 60 * 60;
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ iat, exp, sst: iat, jti })}.sig`;
}

function makeDeps(over: Partial<SlideDeps> = {}): SlideDeps {
  return {
    refresh: vi.fn(async () => ({ token: 'new-token' })),
    replaceSession: vi.fn(async () => {}),
    clearSession: vi.fn(async () => {}),
    slideCookie: vi.fn(async () => {}),
    ...over,
  };
}

describe('applySlide', () => {
  beforeEach(() => __resetMemoForTest());

  it('N concurrent sibling slides of one jti → exactly ONE refresh, ONE replaceSession-per-caller, zero clears', async () => {
    const deps = makeDeps();
    const token = backdatedToken('jA');
    await Promise.all([
      applySlide(deps, token, Date.now()),
      applySlide(deps, token, Date.now()),
      applySlide(deps, token, Date.now()),
    ]);
    expect(deps.refresh).toHaveBeenCalledTimes(1);
    expect(deps.clearSession).not.toHaveBeenCalled();
    for (const call of (deps.replaceSession as any).mock.calls) expect(call[0]).toBe('new-token');
  });

  it('a SEQUENTIAL second slide of the same jti does not refresh again', async () => {
    const deps = makeDeps();
    const token = backdatedToken('jB');
    const now = Date.now();
    await applySlide(deps, token, now);
    await applySlide(deps, token, now + 50); // within MEMO_TTL_MS → reuses the memoized token
    expect(deps.refresh).toHaveBeenCalledTimes(1);
  });

  it('clears ONLY on the absolute-cap signal, keeps the token on a transient/plain 401', async () => {
    const cap = makeDeps({ refresh: vi.fn(async () => { throw { data: { message: 'Session expired' } }; }) });
    await applySlide(cap, backdatedToken('jC'), Date.now());
    expect(cap.clearSession).toHaveBeenCalledTimes(1);

    __resetMemoForTest();
    const transient = makeDeps({ refresh: vi.fn(async () => { throw { data: { message: 'Token revoked' } }; }) });
    await applySlide(transient, backdatedToken('jD'), Date.now());
    expect(transient.clearSession).not.toHaveBeenCalled();
    expect(transient.replaceSession).not.toHaveBeenCalled();
  });

  it('logout race: a tombstone set while the refresh is in flight discards the result (session stays closed)', async () => {
    let resolveRefresh!: (v: { token: string }) => void;
    const deps = makeDeps({ refresh: vi.fn(() => new Promise<{ token: string }>((r) => { resolveRefresh = r; })) });
    const token = backdatedToken('jE');
    const p = applySlide(deps, token, Date.now());
    tombstoneJti('jE', Date.now());
    resolveRefresh({ token: 'reopened' });
    await p;
    expect(deps.replaceSession).not.toHaveBeenCalled();
  });

  it('a token still before its midpoint just slides the cookie (no refresh)', async () => {
    const deps = makeDeps();
    const nowSec = Math.floor(Date.now() / 1000);
    const iat = nowSec - 60; const exp = iat + 30 * 24 * 60 * 60;
    const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const fresh = `${b64({})}.${b64({ iat, exp, sst: iat, jti: 'jF' })}.sig`;
    await applySlide(deps, fresh, Date.now());
    expect(deps.refresh).not.toHaveBeenCalled();
    expect(deps.slideCookie).toHaveBeenCalledTimes(1);
  });
});
