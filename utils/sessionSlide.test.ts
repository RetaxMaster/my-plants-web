import { describe, expect, it } from 'vitest';
import { decodeJwtPayload, decideSlide, REFRESH_AFTER_MS } from './sessionSlide.js';

function fakeJwt(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(payload)}.sig`;
}

describe('decodeJwtPayload', () => {
  it('decodes iat/sst/exp from a well-formed token', () => {
    const claims = decodeJwtPayload(fakeJwt({ iat: 100, sst: 50, exp: 999 }));
    expect(claims).toEqual({ iat: 100, sst: 50, exp: 999 });
  });
  it('returns null for a malformed token', () => {
    expect(decodeJwtPayload('not-a-jwt')).toBeNull();
    expect(decodeJwtPayload('a.b')).toBeNull();
    expect(decodeJwtPayload('a.%%%.c')).toBeNull();
  });
  it('returns null when iat/exp are missing or non-numeric', () => {
    const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
    expect(decodeJwtPayload(`h.${b64({ sub: 'x' })}.s`)).toBeNull();
  });
});

describe('decideSlide', () => {
  const iatSec = 1_000_000;
  it("returns 'slide' while younger than the refresh threshold", () => {
    const now = iatSec * 1000 + (REFRESH_AFTER_MS - 1000);
    expect(decideSlide({ iat: iatSec, exp: iatSec + 1 }, now)).toBe('slide');
  });
  it("returns 'refresh' once older than the refresh threshold", () => {
    const now = iatSec * 1000 + (REFRESH_AFTER_MS + 1000);
    expect(decideSlide({ iat: iatSec, exp: iatSec + 1 }, now)).toBe('refresh');
  });
});

describe('REFRESH_AFTER_MS', () => {
  it('is 15 days (half of the 30-day token life)', () => {
    expect(REFRESH_AFTER_MS).toBe(15 * 24 * 60 * 60 * 1000);
  });
});
